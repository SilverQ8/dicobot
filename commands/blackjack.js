const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { createDeck, calculateBlackjackScore } = require('../utils/cards');
const economy = require('../utils/economy');

// 진행 중인 게임 세션 (메모리)
const bjSessions = new Map();

function formatCards(cards, hideSecond = false) {
  if (hideSecond) {
    return `${cards[0].toString()} \`[❓ 숨김]\``;
  }
  return cards.map((c) => c.toString()).join(' ');
}

function createBlackjackEmbed(session, gameOver = false, resultText = '') {
  const playerScore = calculateBlackjackScore(session.playerHand);
  const dealerScore = gameOver
    ? calculateBlackjackScore(session.dealerHand)
    : calculateBlackjackScore([session.dealerHand[0]]);

  const embed = new EmbedBuilder()
    .setTitle('🃏 블랙잭 (Blackjack)')
    .setColor(gameOver ? (resultText.includes('승리') ? 0x2ecc71 : resultText.includes('무승부') ? 0xf1c40f : 0xe74c3c) : 0x3498db)
    .addFields(
      {
        name: `🤖 딜러 카드 (${gameOver ? dealerScore + '점' : '??'})`,
        value: formatCards(session.dealerHand, !gameOver),
        inline: false,
      },
      {
        name: `👤 ${session.userName} 님의 카드 (${playerScore}점)`,
        value: formatCards(session.playerHand),
        inline: false,
      },
      {
        name: '💰 배팅 금액',
        value: `**${session.bet.toLocaleString()} 코인**`,
        inline: true,
      }
    )
    .setTimestamp();

  if (gameOver) {
    embed.setDescription(`### ${resultText}`);
  }

  return embed;
}

function createActionButtons(sessionId, canDouble = false) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bj_hit_${sessionId}`)
      .setLabel('히트 (Hit) 🃏')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`bj_stand_${sessionId}`)
      .setLabel('스탠드 (Stand) 🛑')
      .setStyle(ButtonStyle.Secondary)
  );

  if (canDouble) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`bj_double_${sessionId}`)
        .setLabel('더블다운 (Double) 💥')
        .setStyle(ButtonStyle.Danger)
    );
  }

  return row;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('블랙잭')
    .setDescription('코인을 배팅하고 딜러와 1:1 블랙잭 대결을 합니다!')
    .addIntegerOption((opt) =>
      opt
        .setName('배팅')
        .setDescription('배팅할 코인 개수를 입력하세요 (기본값/최소: 100 코인)')
        .setMinValue(100)
        .setRequired(false)
    ),

  async execute(interaction) {
    const bet = interaction.options.getInteger('배팅') || 100;
    return this.startWithBet(interaction, bet);
  },

  async startWithBet(interaction, bet) {
    const userId = interaction.user.id;
    const balance = economy.getBalance(userId);

    if (balance < bet) {
      return interaction.reply({
        content: `❌ 보유 코인이 부족합니다! (현재 잔액: **${balance.toLocaleString()} 코인** / 배팅 요청: **${bet.toLocaleString()} 코인**)\n/일일지원금 으로 매일 코인을 충전할 수 있습니다.`,
        ephemeral: true,
      });
    }

    // 이미 진행 중인 게임이 있는지 확인
    for (const [_, sess] of bjSessions) {
      if (sess.userId === userId) {
        return interaction.reply({
          content: '⚠️ 이미 진행 중인 블랙잭 게임이 있습니다! 해당 게임을 먼저 완료해주세요.',
          ephemeral: true,
        });
      }
    }

    // 코인 선차감
    economy.modifyCoins(userId, -bet);

    // 덱 생성 및 카드 분배
    const deck = createDeck();
    const playerHand = [deck.pop(), deck.pop()];
    const dealerHand = [deck.pop(), deck.pop()];

    const sessionId = interaction.id;
    const session = {
      sessionId,
      userId,
      userName: interaction.user.displayName,
      deck,
      playerHand,
      dealerHand,
      bet,
      canDouble: balance >= bet * 2,
    };

    bjSessions.set(sessionId, session);

    const playerScore = calculateBlackjackScore(playerHand);
    const dealerScore = calculateBlackjackScore(dealerHand);

    // 내추럴 블랙잭(21점) 즉시 확인
    if (playerScore === 21 || dealerScore === 21) {
      bjSessions.delete(sessionId);

      let resultText = '';
      if (playerScore === 21 && dealerScore === 21) {
        resultText = '🤝 둘 다 블랙잭! 무승부 (배팅금 환급)';
        economy.modifyCoins(userId, bet);
      } else if (playerScore === 21) {
        const reward = Math.floor(bet * 2.5);
        resultText = `🎉 블랙잭(Blackjack)! 플레이어 승리! (+${(reward - bet).toLocaleString()} 코인)`;
        economy.modifyCoins(userId, reward);
      } else {
        resultText = `💀 딜러 블랙잭! 플레이어 패배! (-${bet.toLocaleString()} 코인)`;
      }

      const embed = createBlackjackEmbed(session, true, resultText);
      return interaction.reply({ embeds: [embed] });
    }

    const embed = createBlackjackEmbed(session, false);
    const row = createActionButtons(sessionId, session.canDouble);

    await interaction.reply({ embeds: [embed], components: [row] });
  },

  // 버튼 인터랙션 처리
  async handleButton(interaction) {
    const [_, action, sessionId] = interaction.customId.split('_');
    const session = bjSessions.get(sessionId);

    if (!session) {
      return interaction.reply({
        content: '⚠️ 유효하지 않거나 이미 종료된 게임입니다.',
        ephemeral: true,
      });
    }

    if (session.userId !== interaction.user.id) {
      return interaction.reply({
        content: '❌ 본인의 게임 버튼만 조작할 수 있습니다!',
        ephemeral: true,
      });
    }

    const userId = session.userId;

    // 1. 히트 (Hit)
    if (action === 'hit') {
      session.canDouble = false;
      session.playerHand.push(session.deck.pop());
      const score = calculateBlackjackScore(session.playerHand);

      if (score > 21) {
        // 버스트(Bust) - 패배
        bjSessions.delete(sessionId);
        const embed = createBlackjackEmbed(
          session,
          true,
          `💥 21점 초과(버스트)! 플레이어 패배 (-${session.bet.toLocaleString()} 코인)`
        );
        return interaction.update({ embeds: [embed], components: [] });
      }

      if (score === 21) {
        // 21점이면 자동 스탠드
        return this.finishDealerTurn(interaction, session);
      }

      const embed = createBlackjackEmbed(session, false);
      const row = createActionButtons(sessionId, false);
      return interaction.update({ embeds: [embed], components: [row] });
    }

    // 2. 더블다운 (Double Down)
    if (action === 'double') {
      economy.modifyCoins(userId, -session.bet);
      session.bet *= 2;
      session.playerHand.push(session.deck.pop());

      const score = calculateBlackjackScore(session.playerHand);
      if (score > 21) {
        bjSessions.delete(sessionId);
        const embed = createBlackjackEmbed(
          session,
          true,
          `💥 더블다운 버스트! 플레이어 패배 (-${session.bet.toLocaleString()} 코인)`
        );
        return interaction.update({ embeds: [embed], components: [] });
      }

      return this.finishDealerTurn(interaction, session);
    }

    // 3. 스탠드 (Stand)
    if (action === 'stand') {
      return this.finishDealerTurn(interaction, session);
    }
  },

  // 딜러 턴 및 최종 승패 정산
  async finishDealerTurn(interaction, session) {
    bjSessions.delete(session.sessionId);

    // 딜러는 16점 이하일 때 계속 히트, 17점 이상이면 스탠드
    while (calculateBlackjackScore(session.dealerHand) < 17) {
      session.dealerHand.push(session.deck.pop());
    }

    const playerScore = calculateBlackjackScore(session.playerHand);
    const dealerScore = calculateBlackjackScore(session.dealerHand);

    let resultText = '';
    const userId = session.userId;
    const bet = session.bet;

    if (dealerScore > 21) {
      resultText = `🎉 딜러 버스트(${dealerScore}점)! 플레이어 승리! (+${bet.toLocaleString()} 코인)`;
      economy.modifyCoins(userId, bet * 2);
    } else if (playerScore > dealerScore) {
      resultText = `🎉 ${playerScore} 대 ${dealerScore} 로 플레이어 승리! (+${bet.toLocaleString()} 코인)`;
      economy.modifyCoins(userId, bet * 2);
    } else if (playerScore < dealerScore) {
      resultText = `💀 ${dealerScore} 대 ${playerScore} 로 딜러 승리! (-${bet.toLocaleString()} 코인)`;
    } else {
      resultText = `🤝 ${playerScore}점 동점! 무승부(Push) (배팅금 환급)`;
      economy.modifyCoins(userId, bet);
    }

    const embed = createBlackjackEmbed(session, true, resultText);
    return interaction.update({ embeds: [embed], components: [] });
  },
};
