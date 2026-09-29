const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const economy = require('../utils/economy');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('돈')
    .setDescription('현재 보유 중인 코인 잔액을 확인합니다.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const balance = economy.getBalance(userId);

    const embed = new EmbedBuilder()
      .setTitle('🪙 코인 지갑')
      .setColor(0xf1c40f)
      .setDescription(`**${interaction.user.displayName}** 님의 보유 코인: **${balance.toLocaleString()} 코인**`)
      .setFooter({ text: '매일 자정에 초기화되는 /일일지원금 명령어로 5,000 코인을 받을 수 있습니다!' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};
