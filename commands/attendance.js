const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const economy = require('../utils/economy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('일일지원금')
    .setDescription('하루 한 번(자정 기준) 5,000 코인을 지원금으로 받습니다.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const result = economy.claimAttendance(userId);

    if (!result.success) {
      return interaction.reply({
        content: '⏰ **이미 오늘 일일지원금을 수령하셨습니다!**\n매일 밤 자정(00:00) 이후에 다시 받을 수 있습니다.',
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎁 일일지원금 수령 완료!')
      .setColor(0x2ecc71)
      .setDescription(
        `지원금으로 **+${result.amount.toLocaleString()} 코인**이 지급되었습니다!\n` +
        `현재 보유 코인: **${result.newBalance.toLocaleString()} 코인**`
      )
      .setFooter({ text: '매일 자정(00:00)에 다시 수령할 수 있습니다.' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
