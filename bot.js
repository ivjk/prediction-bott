const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');

// Bot configuration
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Store prediction data and system stats
let todaysPrediction = {
    itemNumber: null,
    robuxCost: null,
    isSet: false,
    lastUpdated: null,
    originalCost: null
};

let systemStats = {
    totalPredictions: 0,
    successfulPredictions: 0,
    totalSaved: 0,
    lastAccuracyUpdate: null
};

// Channel IDs
const PREDICTION_CHANNEL_ID = process.env.PREDICTION_CHANNEL_ID || '1386228833203781804';
const HISTORY_CHANNEL_ID = process.env.HISTORY_CHANNEL_ID || '1386229029795008622';
const VOICE_STATUS_CHANNEL_ID = process.env.VOICE_STATUS_CHANNEL_ID || '1386504457159839765';

// Bot ready event
client.once('ready', () => {
    console.log(`✓ Bot is online as ${client.user.tag}`);
    console.log('▸ Scheduled for 7 PM Central Time daily');
    
    // Initialize voice channel status
    updateVoiceChannelStatus();
});

// Slash command registration
const commands = [
    new SlashCommandBuilder()
        .setName('setprediction')
        .setDescription('Set today\'s Super Seed prediction')
        .addIntegerOption(option =>
            option.setName('item_number')
                .setDescription('Which item position contains the Super Seed')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(999))
        .addIntegerOption(option =>
            option.setName('robux_cost')
                .setDescription('Total Robux cost to reach that item')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(999999))
        .setDefaultMemberPermissions('0'), // Only admins can use

    new SlashCommandBuilder()
        .setName('updatecost')
        .setDescription('Update the Robux cost for today\'s prediction (prices change throughout day)')
        .addIntegerOption(option =>
            option.setName('new_cost')
                .setDescription('Updated total Robux cost')
                .setRequired(true)
                .setMinValue(1)
                .setMaxValue(999999))
        .setDefaultMemberPermissions('0'),

    new SlashCommandBuilder()
        .setName('sendprediction')
        .setDescription('Manually send today\'s prediction now')
        .setDefaultMemberPermissions('0'), // Only admins can use

    new SlashCommandBuilder()
        .setName('checkprediction')
        .setDescription('Check what prediction is set for today')
        .setDefaultMemberPermissions('0'), // Only admins can use

    new SlashCommandBuilder()
        .setName('clearprediction')
        .setDescription('Clear today\'s prediction data')
        .setDefaultMemberPermissions('0'),

    new SlashCommandBuilder()
        .setName('predictionstats')
        .setDescription('View prediction system statistics')
        .setDefaultMemberPermissions('0'),

    new SlashCommandBuilder()
        .setName('emergency')
        .setDescription('Send emergency message to prediction channel')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Emergency message to send')
                .setRequired(true))
        .setDefaultMemberPermissions('0'),

    new SlashCommandBuilder()
        .setName('quickupdate')
        .setDescription('Quick update for minor changes')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('What to update')
                .setRequired(true)
                .addChoices(
                    { name: 'Cost went up (packs got more expensive)', value: 'cost_increase' },
                    { name: 'Position changed (new calculation)', value: 'position_change' },
                    { name: 'Accuracy update (success/failure)', value: 'accuracy_update' }
                ))
        .addStringOption(option =>
            option.setName('details')
                .setDescription('Additional details about the update')
                .setRequired(false))
        .setDefaultMemberPermissions('0')
];

// Handle slash commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName } = interaction;

    try {
        if (commandName === 'setprediction') {
            const itemNumber = interaction.options.getInteger('item_number');
            const robuxCost = interaction.options.getInteger('robux_cost');

            // Store the prediction
            todaysPrediction = {
                itemNumber: itemNumber,
                robuxCost: robuxCost,
                isSet: true,
                lastUpdated: new Date(),
                originalCost: robuxCost
            };

            systemStats.totalPredictions++;

            const costInfo = getCostInfo(robuxCost);
            
            // Update voice channel status
            await updateVoiceChannelStatus(costInfo);
            
            await interaction.reply({
                content: `✓ **Prediction Set Successfully**\n\n▸ **Item Position:** ${itemNumber}\n▸ **Total Cost:** ${robuxCost.toLocaleString()} Robux\n${costInfo.status}\n▸ **Auto-Post:** 7 PM Central Time`,
                ephemeral: true
            });

        } else if (commandName === 'updatecost') {
            if (!todaysPrediction.isSet) {
                await interaction.reply({
                    content: '✗ No prediction is set for today. Use `/setprediction` first.',
                    ephemeral: true
                });
                return;
            }

            const newCost = interaction.options.getInteger('new_cost');
            const oldCost = todaysPrediction.robuxCost;
            
            todaysPrediction.robuxCost = newCost;
            todaysPrediction.lastUpdated = new Date();
            
            const costInfo = getCostInfo(newCost);
            await updateVoiceChannelStatus(costInfo);
            
            // Send update to prediction channel
            const channel = client.channels.cache.get(PREDICTION_CHANNEL_ID);
            if (channel) {
                const updateEmbed = new EmbedBuilder()
                    .setTitle('⚡ COST UPDATE')
                    .setDescription(`**Today's prediction cost has been updated**`)
                    .addFields(
                        {
                            name: '▸ Previous Cost',
                            value: `${oldCost.toLocaleString()} Robux`,
                            inline: true
                        },
                        {
                            name: '▸ New Cost',
                            value: `${newCost.toLocaleString()} Robux`,
                            inline: true
                        },
                        {
                            name: '▸ Status',
                            value: `${costInfo.emoji} ${costInfo.status.replace('▸ **Status:** ', '')}`,
                            inline: true
                        }
                    )
                    .setColor(costInfo.color)
                    .setFooter({ text: 'Pack prices change throughout the day • Position remains the same' })
                    .setTimestamp();
                
                await channel.send({ embeds: [updateEmbed] });
            }

            await interaction.reply({
                content: `✓ **Cost Updated**\n\n▸ **Old Cost:** ${oldCost.toLocaleString()} Robux\n▸ **New Cost:** ${newCost.toLocaleString()} Robux\n${costInfo.status}\n▸ **Update sent to channel**`,
                ephemeral: true
            });

        } else if (commandName === 'clearprediction') {
            if (!todaysPrediction.isSet) {
                await interaction.reply({
                    content: '✗ No prediction is currently set.',
                    ephemeral: true
                });
                return;
            }

            todaysPrediction = {
                itemNumber: null,
                robuxCost: null,
                isSet: false,
                lastUpdated: null,
                originalCost: null
            };
            
            await updateVoiceChannelStatus();

            await interaction.reply({
                content: '✓ **Prediction Cleared**\n\n▸ All prediction data has been reset\n▸ Voice channel updated\n▸ Ready for new prediction',
                ephemeral: true
            });

        } else if (commandName === 'predictionstats') {
            const accuracyRate = systemStats.totalPredictions > 0 
                ? Math.round((systemStats.successfulPredictions / systemStats.totalPredictions) * 100)
                : 0;

            await interaction.reply({
                content: `📊 **Prediction System Statistics**\n\n▸ **Total Predictions:** ${systemStats.totalPredictions}\n▸ **Successful:** ${systemStats.successfulPredictions}\n▸ **Accuracy Rate:** ${accuracyRate}%\n▸ **Total Robux Saved:** ${systemStats.totalSaved.toLocaleString()}\n▸ **Current Prediction:** ${todaysPrediction.isSet ? 'Set' : 'Not Set'}\n▸ **Last Updated:** ${todaysPrediction.lastUpdated ? todaysPrediction.lastUpdated.toLocaleString() : 'Never'}`,
                ephemeral: true
            });

        } else if (commandName === 'emergency') {
            const emergencyMessage = interaction.options.getString('message');
            const channel = client.channels.cache.get(PREDICTION_CHANNEL_ID);
            
            if (!channel) {
                await interaction.reply({
                    content: '✗ Prediction channel not found.',
                    ephemeral: true
                });
                return;
            }

            const emergencyEmbed = new EmbedBuilder()
                .setTitle('🚨 URGENT UPDATE')
                .setDescription(emergencyMessage)
                .setColor(0xFF4444)
                .setFooter({ text: 'Emergency notification from staff' })
                .setTimestamp();

            await channel.send({ 
                content: '@everyone 🚨 **URGENT UPDATE**',
                embeds: [emergencyEmbed] 
            });

            await interaction.reply({
                content: '✓ **Emergency message sent**\n\n▸ Message posted to prediction channel\n▸ All members pinged',
                ephemeral: true
            });

        } else if (commandName === 'quickupdate') {
            const updateType = interaction.options.getString('type');
            const details = interaction.options.getString('details') || '';
            const channel = client.channels.cache.get(PREDICTION_CHANNEL_ID);
            
            let updateTitle = '';
            let updateColor = 0xFFED00; // Yellow
            let updateIcon = '⚡';
            
            switch(updateType) {
                case 'cost_increase':
                    updateTitle = 'COST INCREASE';
                    updateIcon = '📈';
                    updateColor = 0xFF8C00;
                    break;
                case 'position_change':
                    updateTitle = 'POSITION UPDATE';
                    updateIcon = '🎯';
                    updateColor = 0x0099FF;
                    break;
                case 'accuracy_update':
                    updateTitle = 'ACCURACY UPDATE';
                    updateIcon = '📊';
                    updateColor = 0x00FF44;
                    break;
            }
            
            if (channel) {
                const quickEmbed = new EmbedBuilder()
                    .setTitle(`${updateIcon} ${updateTitle}`)
                    .setDescription(details || `Quick update regarding today's prediction`)
                    .setColor(updateColor)
                    .setFooter({ text: 'Quick update from prediction team' })
                    .setTimestamp();

                await channel.send({ embeds: [quickEmbed] });
            }

            await interaction.reply({
                content: `✓ **Quick Update Sent**\n\n▸ **Type:** ${updateTitle}\n▸ **Posted to channel**${details ? `\n▸ **Details:** ${details}` : ''}`,
                ephemeral: true
            });

        } else if (commandName === 'sendprediction') {
            if (!todaysPrediction.isSet) {
                await interaction.reply({
                    content: '✗ No prediction is set for today. Use `/setprediction` first.',
                    ephemeral: true
                });
                return;
            }

            const channel = client.channels.cache.get(PREDICTION_CHANNEL_ID);
            if (!channel) {
                await interaction.reply({
                    content: '✗ Prediction channel not found. Check the channel ID.',
                    ephemeral: true
                });
                return;
            }

            // Send the prediction with @everyone ping
            await sendDailyPrediction(channel);
            await interaction.reply({
                content: '✓ Prediction sent manually to daily channel (with @everyone ping) and logged to history.',
                ephemeral: true
            });

        } else if (commandName === 'checkprediction') {
            if (!todaysPrediction.isSet) {
                await interaction.reply({
                    content: '✗ No prediction is set for today.',
                    ephemeral: true
                });
                return;
            }

            const costInfo = getCostInfo(todaysPrediction.robuxCost);
            
            await interaction.reply({
                content: `▣ **Current Prediction**\n\n▸ **Item Position:** ${todaysPrediction.itemNumber}\n▸ **Total Cost:** ${todaysPrediction.robuxCost.toLocaleString()} Robux\n${costInfo.status}\n▸ **Next Auto-Post:** 7 PM Central Time`,
                ephemeral: true
            });
        }
    } catch (error) {
        console.error('Command error:', error);
        await interaction.reply({
            content: '✗ An error occurred while processing the command.',
            ephemeral: true
        });
    }
});

// Helper function to update voice channel status
async function updateVoiceChannelStatus(costInfo = null) {
    try {
        const voiceChannel = client.channels.cache.get(VOICE_STATUS_CHANNEL_ID);
        if (!voiceChannel) {
            console.log('⚠ Voice status channel not found');
            return;
        }

        let channelName;
        if (costInfo && todaysPrediction.isSet) {
            const statusText = costInfo.status.replace('▸ **Status:** ', '');
            channelName = `Today's Prediction: ${costInfo.emoji} ${statusText}`;
        } else {
            channelName = `Today's Prediction: ⚫ No prediction set`;
        }

        await voiceChannel.setName(channelName);
        console.log(`✓ Voice channel updated: ${channelName}`);
    } catch (error) {
        console.error('✗ Error updating voice channel:', error);
    }
}
function getCostInfo(robuxCost) {
    if (robuxCost <= 1000) {
        return {
            color: 0x00FF44, // Green
            status: "▸ **Status:** CLOSE - Low cost prediction",
            emoji: "🟢"
        };
    } else if (robuxCost <= 5000) {
        return {
            color: 0xFFED00, // Yellow
            status: "▸ **Status:** MODERATE - Medium cost prediction", 
            emoji: "🟡"
        };
    } else {
        return {
            color: 0xFF4444, // Red
            status: "▸ **Status:** FAR - High cost prediction",
            emoji: "🔴"
        };
    }
}

// Helper function for ordinal numbers (1st, 2nd, 3rd, etc.)
function getOrdinalSuffix(num) {
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
}

// Function to send daily prediction
async function sendDailyPrediction(channel) {
    if (!todaysPrediction.isSet) {
        console.log('⚠ No prediction set for today - skipping scheduled post');
        return;
    }

    const costInfo = getCostInfo(todaysPrediction.robuxCost);

    const embed = new EmbedBuilder()
        .setTitle('◈ Daily Super Seed Prediction')
        .setDescription('**Today\'s exact position and cost prediction**')
        .addFields(
            {
                name: '▸ Item Position',
                value: `**${todaysPrediction.itemNumber}**\nThe Super Seed will be the **${todaysPrediction.itemNumber}${getOrdinalSuffix(todaysPrediction.itemNumber)}** item you receive`,
                inline: true
            },
            {
                name: '▸ Total Cost',
                value: `**${todaysPrediction.robuxCost.toLocaleString()} Robux**\nTotal cost to reach this position`,
                inline: true
            },
            {
                name: '▸ Cost Status',
                value: `${costInfo.emoji} ${costInfo.status.replace('▸ **Status:** ', '')}`,
                inline: true
            },
            {
                name: '▸ Instructions',
                value: '⟐ Buy Forever Packs one by one\n⟐ Count each item you receive\n⟐ Stop when you reach the predicted position\n⟐ Claim your Super Seed',
                inline: false
            },
            {
                name: '▸ Pro Tips',
                value: '◦ Buy early in the day for cheaper pack costs\n◦ Take screenshots for proof\n◦ Share your success in the community',
                inline: false
            }
        )
        .setColor(costInfo.color)
        .setFooter({ 
            text: 'VIP Exclusive • 99% Accuracy • Next update: Tomorrow 7 PM CT',
            iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp();

    try {
        // Send main prediction with @everyone ping
        await channel.send({ 
            content: `@everyone ${costInfo.emoji} **NEW PREDICTION AVAILABLE**`,
            embeds: [embed] 
        });
        
        // Send shorter log to history channel
        const historyChannel = client.channels.cache.get(HISTORY_CHANNEL_ID);
        if (historyChannel) {
            const historyEmbed = new EmbedBuilder()
                .setTitle(`▸ ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`)
                .setDescription(`**Position ${todaysPrediction.itemNumber}** • **${todaysPrediction.robuxCost.toLocaleString()} Robux** ${costInfo.emoji}`)
                .setColor(costInfo.color)
                .setTimestamp();
                
            await historyChannel.send({ embeds: [historyEmbed] });
            console.log(`▣ History log sent to #prediction-history`);
        } else {
            console.log('⚠ History channel not found');
        }
        
        console.log(`✓ Daily prediction sent: Item #${todaysPrediction.itemNumber} (${todaysPrediction.robuxCost.toLocaleString()} Robux)`);
        
        // Reset prediction after sending
        todaysPrediction = {
            itemNumber: null,
            robuxCost: null,
            isSet: false,
            lastUpdated: null,
            originalCost: null
        };
        
        // Update voice channel to show no prediction
        await updateVoiceChannelStatus();
        
        console.log('▸ Prediction data cleared - ready for tomorrow\'s prediction');
    } catch (error) {
        console.error('✗ Error sending daily prediction:', error);
    }
}

// Schedule daily prediction for 7 PM Central Time
// Cron: minute hour day month dayOfWeek
// 0 1 * * * = 1 AM UTC (7 PM Central Time, accounting for CST/CDT)
cron.schedule('0 1 * * *', async () => {
    console.log('▸ Scheduled time reached - sending daily prediction...');
    
    const channel = client.channels.cache.get(PREDICTION_CHANNEL_ID);
    if (channel) {
        await sendDailyPrediction(channel);
    } else {
        console.error('✗ Prediction channel not found');
    }
}, {
    timezone: "America/Chicago" // Central Time
});

// Error handling
client.on('error', error => {
    console.error('✗ Bot error:', error);
});

process.on('unhandledRejection', error => {
    console.error('✗ Unhandled promise rejection:', error);
});

// Register slash commands when bot starts
client.on('ready', async () => {
    try {
        console.log('▸ Registering slash commands...');
        await client.application.commands.set(commands);
        console.log('✓ Slash commands registered successfully');
    } catch (error) {
        console.error('✗ Error registering commands:', error);
    }
});

// Login with your bot token
client.login(process.env.BOT_TOKEN);
