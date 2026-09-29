const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const economy = require('../utils/economy');
const blackjackCommand = require('./blackjack');
const holdemCommand = require('./holdem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('도박')
    .setDescription('코인을 배팅하고 즐기는 카지노/도박 게임 목록을 열어 선택합니다.'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const balance = economy.getBalance(userId);

    const embed = new EmbedBuilder()
      .setTitle('🎰 카지노 & 도박장 (코인 베팅)')
      .setColor(0xf1c40f)
      .setDescription(
        `보유 코인을 걸고 승부할 게임을 아래 드롭다운 메뉴에서 선택해주세요!\n\n` +
        `💰 **현재 보유 코인**: **${balance.toLocaleString()} 코인**\n\n` +
        `• 🃏 **블랙잭 (Blackjack)**: 딜러와 1:1 진검승부! 21점에 가까운 쪽이 승리\n` +
        `• ♠️ **텍사스 홀덤 (Texas Holdem)**: 2~6인 실시간 포커 대결 테이블 개설\n\n` +
        `> 💡 *추후 룰렛, 슬롯머신 등 다양한 도박 게임이 계속 추가될 예정입니다!*`
      )
      .setFooter({ text: '게임을 선택하면 배팅 금액 설정 팝업이 나타납니다.' });

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`gamble_select_${interaction.id}`)
      .setPlaceholder('플레이할 도박 게임을 선택하세요')
      .addOptions([
        {
          label: '블랙잭 (Blackjack)',
          value: 'blackjack',
          description: '딜러와 1:1 진검승부! (코인 배팅)',
          emoji: '🃏',
        },
        {
          label: '텍사스 홀덤 (Texas Holdem)',
          value: 'holdem',
          description: '2~6인 정통 포커 테이블 생성 (코인 배팅)',
          emoji: '♠️',
        },
      ]);

    const row = new ActionRowBuilder().addComponents(menu);

    return interaction.reply({
      embeds: [embed],
      components: [row],
    });
  },

  // 드롭다운 메뉴 선택 처리 ➔ 금액 설정 모달 팝업
  async handleSelectMenu(interaction) {
    const value = interaction.values[0];

    if (value === 'blackjack') {
      const modal = new ModalBuilder()
        .setCustomId(`gamble_modal_bj_${interaction.id}`)
        .setTitle('🃏 블랙잭 배팅 금액 설정');

      const betInput = new TextInputBuilder()
        .setCustomId('bet_amount')
        .setLabel('배팅할 코인 개수 (최소 100 코인)')
        .setStyle(TextInputStyle.Short)
        .setValue('100')
        .setMinLength(1)
        .setMaxLength(10)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(betInput));
      return interaction.showModal(modal);
    }

    if (value === 'holdem') {
      const modal = new ModalBuilder()
        .setCustomId(`gamble_modal_holdem_${interaction.id}`)
        .setTitle('♠️ 텍사스 홀덤 빅블라인드 설정');

      const bbInput = new TextInputBuilder()
        .setCustomId('bb_amount')
        .setLabel('빅블라인드(BB) 코인 개수 (최소 100 코인)')
        .setStyle(TextInputStyle.Short)
        .setValue('100')
        .setMinLength(1)
        .setMaxLength(10)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(bbInput));
      return interaction.showModal(modal);
    }
  },

  // 모달 입력 완료 처리 ➔ 실제 게임 실행
  async handleModal(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('gamble_modal_bj_')) {
      const betStr = interaction.fields.getTextInputValue('bet_amount').trim();
      const bet = parseInt(betStr, 10);
      if (isNaN(bet) || bet < 100) {
        return interaction.reply({
          content: '❌ 배팅 금액은 최소 100 코인 이상의 숫자여야 합니다!',
          ephemeral: true,
        });
      }
      return blackjackCommand.startWithBet(interaction, bet);
    }

    if (customId.startsWith('gamble_modal_holdem_')) {
      const bbStr = interaction.fields.getTextInputValue('bb_amount').trim();
      const bb = parseInt(bbStr, 10);
      if (isNaN(bb) || bb < 100) {
        return interaction.reply({
          content: '❌ 빅블라인드 금액은 최소 100 코인 이상의 숫자여야 합니다!',
          ephemeral: true,
        });
      }
      return holdemCommand.startWithBB(interaction, bb);
    }
  },
};
