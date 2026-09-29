const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const mafiaCommand = require('./mafia');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('미니게임')
    .setDescription('코인을 사용하지 않는 파티/추리 미니게임 목록을 열어 선택합니다.'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🎮 미니게임 천국 (코인 사용 X)')
      .setColor(0x3498db)
      .setDescription(
        '친구들과 함께 즐길 미니게임을 아래 드롭다운 메뉴에서 선택해주세요!\n\n' +
        '• 🕵️‍♂️ **마피아 게임**: 4~12인 정통 추리 심리전 (음성 채널 연동 & 유령방 지원)\n\n' +
        '> 💡 *추후 다양한 파티 미니게임들이 계속 추가될 예정입니다!*'
      )
      .setFooter({ text: '원하는 게임을 선택하면 대기실이 바로 생성됩니다.' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`minigame_select_${interaction.id}`)
      .setPlaceholder('플레이할 미니게임을 선택하세요')
      .addOptions([
        {
          label: '마피아 게임',
          value: 'mafia',
          description: '4~12인 정통 추리 심리전 (음성 연동 & 밤낮 마이크 제어)',
          emoji: '🕵️‍♂️',
        },
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    return interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: typeof interaction.isButton === 'function' ? interaction.isButton() : false,
    });
  },

  // 드롭다운 메뉴 선택 처리
  async handleSelectMenu(interaction) {
    const value = interaction.values[0];

    if (value === 'mafia') {
      return mafiaCommand.startFromSelect(interaction);
    }
  },
};
