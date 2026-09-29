const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { createDeck } = require('../utils/cards');
const { evaluate7Cards, compareScores } = require('../utils/pokerHand');
const economy = require('../utils/economy');

// 진행 중인 홀덤 게임 세션 (메모리)
const holdemSessions = new Map();

function formatCardsList(cards) {
  return cards.map((c) => c.toString()).join(' ');
}

const STAGE_NAMES = {
  LOBBY: '대기실',
  PREFLOP: '프리플랍 (Pre-flop)',
  FLOP: '플랍 (Flop)',
  TURN: '턴 (Turn)',
  RIVER: '리버 (River)',
  SHOWDOWN: '쇼다운 (Showdown)',
};

// 로비 임베드
function createLobbyEmbed(session) {
  const playerList = session.players
    .map(
      (p, idx) =>
        `${idx + 1}. **${p.name}** ${p.id === session.hostId ? '👑(방장)' : ''}`
    )
    .join('\n');

  return new EmbedBuilder()
    .setTitle('♠️ 정통 텍사스 홀덤 테이블 (대기실)')
    .setColor(0x2ecc71)
    .setDescription(
      `**방장**: <@${session.hostId}>\n` +
      `**빅 블라인드 (BB)**: **${session.bb.toLocaleString()} 코인**\n` +
      `**스몰 블라인드 (SB)**: **${session.sb.toLocaleString()} 코인**\n\n` +
      `### 👥 참가자 명단 (${session.players.length}명 / 최대 6명)\n${playerList}`
    )
    .setFooter({ text: '최소 2명 이상 모이면 방장이 [게임 시작]을 누를 수 있습니다.' });
}

// 게임 진행 중 임베드
function createGameEmbed(session, gameOver = false, winnerText = '') {
  let communityText = '';
  if (session.stage === 'PREFLOP') {
    communityText = '`[ ❓ ]` `[ ❓ ]` `[ ❓ ]` `[ ❓ ]` `[ ❓ ]`';
  } else if (session.stage === 'FLOP') {
    communityText = `${formatCardsList(session.communityCards.slice(0, 3))} \`[ ❓ ]\` \`[ ❓ ]\``;
  } else if (session.stage === 'TURN') {
    communityText = `${formatCardsList(session.communityCards.slice(0, 4))} \`[ ❓ ]\``;
  } else {
    // RIVER or SHOWDOWN
    communityText = formatCardsList(session.communityCards);
  }

  const currentTurnPlayer = session.players[session.currentTurnIndex];

  // 포지션 명칭 부여 (2인 헤즈업 vs 3인 이상)
  const n = session.players.length;
  const playerStatusList = session.players
    .map((p, idx) => {
      let posBadge = '';
      if (n === 2) {
        if (idx === session.dealerIndex) posBadge = '`[BTN/SB]` ';
        else posBadge = '`[BB]` ';
      } else {
        if (idx === session.dealerIndex) posBadge = '`[BTN]` ';
        else if (idx === (session.dealerIndex + 1) % n) posBadge = '`[SB]` ';
        else if (idx === (session.dealerIndex + 2) % n) posBadge = '`[BB]` ';
      }

      let status = '';
      if (p.folded) {
        status = '🏳️ *폴드*';
      } else if (p.allIn) {
        status = '🔥 *올인*';
      } else if (!gameOver && idx === session.currentTurnIndex) {
        status = `👉 **현재 턴** (${p.currentBet.toLocaleString()} 코인 베팅)`;
      } else {
        status = `${p.currentBet.toLocaleString()} 코인 베팅`;
      }

      return `${posBadge}**${p.name}**: ${status}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`♠️ 정통 텍사스 홀덤 - ${STAGE_NAMES[session.stage] || session.stage}`)
    .setColor(gameOver ? 0xf1c40f : 0x3498db)
    .addFields(
      {
        name: '🃏 커뮤니티 카드 (공용 5장)',
        value: communityText || '*없음*',
        inline: false,
      },
      {
        name: '💰 총 팟 (상금)',
        value: `**${session.pot.toLocaleString()} 코인**`,
        inline: true,
      },
      {
        name: '🎯 현재 콜 기준액',
        value: `**${session.currentBet.toLocaleString()} 코인**`,
        inline: true,
      },
      {
        name: '👥 플레이어 & 포지션',
        value: playerStatusList,
        inline: false,
      }
    )
    .setTimestamp();

  if (gameOver) {
    embed.setDescription(`### 🏆 쇼다운 결과 발표\n${winnerText}`);
  } else {
    embed.setDescription(
      `👉 **<@${currentTurnPlayer.id}>** 님의 차례입니다!\n` +
      `💡 아래 **[내 패 확인 👁️]** 버튼을 누르면 본인에게만 2장의 홀 카드가 보입니다.`
    );
  }

  return embed;
}

// 액션 버튼 생성
function createTurnButtons(sessionId, session) {
  const currentTurnPlayer = session.players[session.currentTurnIndex];
  const callCost = session.currentBet - currentTurnPlayer.currentBet;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`holdem_viewhand_${sessionId}`)
      .setLabel('내 패 확인 👁️')
      .setStyle(ButtonStyle.Secondary)
  );

  // 체크 또는 콜
  if (callCost === 0) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`holdem_check_${sessionId}`)
        .setLabel('체크 (Check) ✋')
        .setStyle(ButtonStyle.Success)
    );
  } else {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`holdem_call_${sessionId}`)
        .setLabel(`콜 (${callCost.toLocaleString()} 코인) 💰`)
        .setStyle(ButtonStyle.Primary)
    );
  }

  // 레이즈 (모달 팝업 입력 방식 - 콜 금액보다 잔액이 많을 때만 가능)
  const userBalance = economy.getBalance(currentTurnPlayer.id);
  if (userBalance > callCost) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`holdem_raise_${sessionId}`)
        .setLabel('레이즈 (금액입력) 📈')
        .setStyle(ButtonStyle.Success)
    );
  }

  // 올인 (All-In)
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`holdem_allin_${sessionId}`)
      .setLabel('올인 (All-In) 🔥')
      .setStyle(ButtonStyle.Primary)
  );

  // 폴드
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`holdem_fold_${sessionId}`)
      .setLabel('폴드 (Fold) ❌')
      .setStyle(ButtonStyle.Danger)
  );

  return row;
}

// 게임 종료 시 나타나는 버튼 (한 판 더 / 테이블 종료)
function createGameOverButtons(sessionId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`holdem_rematch_${sessionId}`)
      .setLabel('한 판 더! (다음 핸드) 🔄')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`holdem_close_${sessionId}`)
      .setLabel('테이블 종료 🚪')
      .setStyle(ButtonStyle.Danger)
  );
}

// 공통 게임 메시지 업데이트 함수
async function updateBoardMessage(interaction, session, gameOver = false, winnerText = '') {
  const embed = createGameEmbed(session, gameOver, winnerText);
  const row = gameOver
    ? [createGameOverButtons(session.sessionId)]
    : [createTurnButtons(session.sessionId, session)];

  try {
    // 1. 모달 제출 인터랙션인 경우: 채널 메시지를 직접 가져와서 수정
    if (interaction.isModalSubmit && interaction.isModalSubmit()) {
      if (session.messageId && interaction.channel) {
        const boardMsg = await interaction.channel.messages.fetch(session.messageId).catch(() => null);
        if (boardMsg) {
          await boardMsg.edit({ embeds: [embed], components: row });
          return;
        }
      }
    }

    // 2. 일반 버튼 인터랙션인 경우 (아직 응답 안 했을 때 즉시 update)
    if (interaction.isButton && interaction.isButton()) {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.update({ embeds: [embed], components: row });
        return;
      }
    }

    // 3. session.messageId로 채널 메시지 직접 수정
    if (session.messageId && interaction.channel) {
      const boardMsg = await interaction.channel.messages.fetch(session.messageId).catch(() => null);
      if (boardMsg) {
        await boardMsg.edit({ embeds: [embed], components: row });
        return;
      }
    }

    // 4. interaction.message 폴백
    if (interaction.message) {
      await interaction.message.edit({ embeds: [embed], components: row });
    }
  } catch (err) {
    console.error('보드 메시지 업데이트 오류:', err);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('홀덤')
    .setDescription('정통 룰(블라인드, 포지션, 4회 베팅) 텍사스 홀덤 테이블을 생성합니다.')
    .addSubcommand((sub) =>
      sub
        .setName('테이블생성')
        .setDescription('홀덤 방을 생성합니다.')
        .addIntegerOption((opt) =>
          opt
            .setName('빅블라인드')
            .setDescription('빅 블라인드(BB) 코인 개수를 입력하세요 (기본값/최소: 100 코인)')
            .setMinValue(100)
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const bb = interaction.options.getInteger('빅블라인드') || 100;
    return this.startWithBB(interaction, bb);
  },

  async startWithBB(interaction, bb) {
    const sb = Math.floor(bb / 2);
    const userId = interaction.user.id;
    const balance = economy.getBalance(userId);

    if (balance < bb) {
      return interaction.reply({
        content: `❌ 보유 코인이 부족합니다! (현재 잔액: **${balance.toLocaleString()} 코인** / 최소 필요: **${bb.toLocaleString()} 코인**)\n/일일지원금 으로 충전할 수 있습니다.`,
        ephemeral: true,
      });
    }

    const sessionId = interaction.id;
    const session = {
      sessionId,
      hostId: userId,
      channelId: interaction.channelId,
      bb,
      sb,
      minRaise: bb,
      pot: 0,
      stage: 'LOBBY',
      dealerIndex: 0,
      currentBet: 0,
      currentTurnIndex: 0,
      players: [
        {
          id: userId,
          name: interaction.user.displayName,
          hand: [],
          folded: false,
          allIn: false,
          currentBet: 0,
          totalBet: 0,
          acted: false,
        },
      ],
      communityCards: [],
      burnedCards: [],
      deck: [],
    };

    holdemSessions.set(sessionId, session);

    const embed = createLobbyEmbed(session);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`holdem_join_${sessionId}`)
        .setLabel('참가하기 🙋')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`holdem_leave_${sessionId}`)
        .setLabel('나가기 🏃')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`holdem_start_${sessionId}`)
        .setLabel('게임 시작 🎬')
        .setStyle(ButtonStyle.Primary)
    );

    const response = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
    session.messageId = response.id;
  },

  // 버튼 인터랙션 핸들러
  async handleButton(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];

    if (action === 'new') {
      const gambleCommand = require('./gamble');
      return gambleCommand.showHoldemModal(interaction);
    }

    const sessionId = parts[2];
    const session = holdemSessions.get(sessionId);

    if (!session) {
      return interaction.reply({
        content: '⚠️ 만료되었거나 존재하지 않는 홀덤 게임입니다.',
        ephemeral: true,
      });
    }

    const userId = interaction.user.id;
    const userBalance = economy.getBalance(userId);

    // ==========================================
    // 0. 게임 종료 후: 한 판 더(다음 핸드) & 테이블 종료
    // ==========================================
    if (action === 'close') {
      const isParticipant = session.players.some((p) => p.id === userId);
      if (!isParticipant && session.hostId !== userId) {
        return interaction.reply({
          content: '❌ 참가자만 테이블을 종료할 수 있습니다.',
          ephemeral: true,
        });
      }

      holdemSessions.delete(sessionId);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('holdem_new')
          .setLabel('새 홀덤 테이블 개설 ♠️')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('gamble_lobby')
          .setLabel('도박 목록 🎰')
          .setStyle(ButtonStyle.Secondary)
      );
      return interaction.update({
        content: '🚪 홀덤 테이블이 정상적으로 종료되었습니다. 수고하셨습니다!',
        embeds: [],
        components: [row],
      });
    }

    if (action === 'rematch') {
      const isParticipant = session.players.some((p) => p.id === userId);
      if (!isParticipant) {
        return interaction.reply({
          content: '❌ 게임 참가자만 다음 판을 시작할 수 있습니다!',
          ephemeral: true,
        });
      }

      // 파산자(Bust out) 검사: 보유 코인이 BB 미만인 유저 제외
      const remainingPlayers = [];
      const bustedNames = [];
      for (const p of session.players) {
        const bal = economy.getBalance(p.id);
        if (bal >= session.bb) {
          remainingPlayers.push(p);
        } else {
          bustedNames.push(p.name);
        }
      }
      session.players = remainingPlayers;

      if (session.players.length < 2) {
        holdemSessions.delete(sessionId);
        let msg = '🚪 코인이 부족한 유저가 탈락하여 남은 참가자가 2명 미만입니다. 테이블이 종료됩니다.';
        if (bustedNames.length > 0) {
          msg += `\n(탈락자: ${bustedNames.join(', ')})`;
        }
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('holdem_new')
            .setLabel('새 홀덤 테이블 개설 ♠️')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('gamble_lobby')
            .setLabel('도박 목록 🎰')
            .setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({
          content: msg,
          embeds: [],
          components: [row],
        });
      }

      // 딜러 버튼 시계 방향 1칸 이동
      session.dealerIndex = (session.dealerIndex + 1) % session.players.length;

      // 새 핸드 시작: 덱 생성, 홀 카드 2장씩 분배
      const deck = createDeck();
      session.deck = deck;
      session.burnedCards = [];
      session.communityCards = [];
      session.pot = 0;

      for (const p of session.players) {
        p.hand = [deck.pop(), deck.pop()];
        p.currentBet = 0;
        p.totalBet = 0;
        p.acted = false;
        p.folded = false;
        p.allIn = false;
      }

      // 포지션 계산
      const n = session.players.length;
      let sbIndex, bbIndex, utgIndex;
      if (n === 2) {
        sbIndex = session.dealerIndex;
        bbIndex = (session.dealerIndex + 1) % n;
        utgIndex = sbIndex;
      } else {
        sbIndex = (session.dealerIndex + 1) % n;
        bbIndex = (session.dealerIndex + 2) % n;
        utgIndex = (session.dealerIndex + 3) % n;
      }

      // 1. SB 강제 베팅
      const sbPlayer = session.players[sbIndex];
      const sbBal = economy.getBalance(sbPlayer.id);
      const sbActual = Math.min(session.sb, sbBal);
      economy.modifyCoins(sbPlayer.id, -sbActual);
      sbPlayer.currentBet = sbActual;
      sbPlayer.totalBet = sbActual;
      if (sbActual < session.sb) sbPlayer.allIn = true;
      session.pot += sbActual;

      // 2. BB 강제 베팅
      const bbPlayer = session.players[bbIndex];
      const bbBal = economy.getBalance(bbPlayer.id);
      const bbActual = Math.min(session.bb, bbBal);
      economy.modifyCoins(bbPlayer.id, -bbActual);
      bbPlayer.currentBet = bbActual;
      bbPlayer.totalBet = bbActual;
      if (bbActual < session.bb) bbPlayer.allIn = true;
      session.pot += bbActual;

      // 프리플랍 시작
      session.stage = 'PREFLOP';
      session.currentBet = session.bb;
      session.minRaise = session.bb;

      // 올인이 아닌 첫 플레이어 찾기
      let turnIndex = utgIndex;
      let loopCount = 0;
      while (session.players[turnIndex].allIn && loopCount < n) {
        turnIndex = (turnIndex + 1) % n;
        loopCount++;
      }
      session.currentTurnIndex = turnIndex;

      // 만약 블라인드 납부 후 베팅 가능 인원이 1명 이하이면 카드 전부 오픈 후 쇼다운
      const bettableRematch = session.players.filter((p) => !p.folded && !p.allIn);
      if (bettableRematch.length <= 1) {
        return this.advanceStreet(interaction, session);
      }

      let rematchNotice = `🔄 **새로운 핸드가 시작되었습니다!** (딜러 버튼 이동 ➔ <@${session.players[session.dealerIndex].id}>)\n`;
      if (bustedNames.length > 0) {
        rematchNotice += `⚠️ 코인 부족으로 탈락한 플레이어: ${bustedNames.join(', ')}\n`;
      }

      const embed = createGameEmbed(session);
      embed.setDescription(rematchNotice + embed.data.description);
      const row = createTurnButtons(sessionId, session);
      return interaction.update({ embeds: [embed], components: [row] });
    }

    // ==========================================
    // 1. 대기실 인터랙션
    // ==========================================
    if (action === 'join') {
      if (session.stage !== 'LOBBY') {
        return interaction.reply({ content: '❌ 이미 게임이 진행 중입니다.', ephemeral: true });
      }
      if (session.players.some((p) => p.id === userId)) {
        return interaction.reply({ content: '⚠️ 이미 참가 중입니다!', ephemeral: true });
      }
      if (session.players.length >= 6) {
        return interaction.reply({ content: '❌ 최대 참가 인원(6명)이 꽉 찼습니다.', ephemeral: true });
      }
      if (userBalance < session.bb) {
        return interaction.reply({
          content: `❌ 최소 빅 블라인드 금액(**${session.bb.toLocaleString()} 코인**) 이상 보유해야 참가할 수 있습니다!\n/일일지원금 으로 충전할 수 있습니다.`,
          ephemeral: true,
        });
      }

      session.players.push({
        id: userId,
        name: interaction.user.displayName,
        hand: [],
        folded: false,
        allIn: false,
        currentBet: 0,
        totalBet: 0,
        acted: false,
      });

      const embed = createLobbyEmbed(session);
      return interaction.update({ embeds: [embed] });
    }

    if (action === 'leave') {
      if (session.stage !== 'LOBBY') {
        return interaction.reply({ content: '❌ 이미 게임이 시작되어 나갈 수 없습니다.', ephemeral: true });
      }
      const playerIdx = session.players.findIndex((p) => p.id === userId);
      if (playerIdx === -1) {
        return interaction.reply({ content: '⚠️ 참가 중이 아닙니다.', ephemeral: true });
      }

      session.players.splice(playerIdx, 1);

      if (session.players.length === 0) {
        holdemSessions.delete(sessionId);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('holdem_new')
            .setLabel('새 홀덤 테이블 개설 ♠️')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('gamble_lobby')
            .setLabel('도박 목록 🎰')
            .setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({
          content: '🚪 모든 참가자가 퇴장하여 테이블이 닫혔습니다.',
          embeds: [],
          components: [row],
        });
      } else if (session.hostId === userId) {
        session.hostId = session.players[0].id;
      }

      const embed = createLobbyEmbed(session);
      return interaction.update({ embeds: [embed] });
    }

    // ==========================================
    // 2. 정통 홀덤 시작 (블라인드 강제 베팅 & 카드 딜링)
    // ==========================================
    if (action === 'start') {
      if (session.stage !== 'LOBBY') return;
      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 게임을 시작할 수 있습니다!', ephemeral: true });
      }
      const n = session.players.length;
      if (n < 2) {
        return interaction.reply({ content: '❌ 최소 2명 이상의 참가자가 필요합니다!', ephemeral: true });
      }

      // 새 52장 덱 생성 및 셔플
      const deck = createDeck();
      session.deck = deck;
      session.burnedCards = [];
      session.communityCards = [];
      session.pot = 0;

      // 각 플레이어에게 홀 카드 2장씩 분배
      for (const p of session.players) {
        p.hand = [deck.pop(), deck.pop()];
        p.currentBet = 0;
        p.totalBet = 0;
        p.acted = false;
        p.folded = false;
        p.allIn = false;
      }

      // 정통 포지션 계산
      let sbIndex, bbIndex, utgIndex;
      if (n === 2) {
        sbIndex = session.dealerIndex;
        bbIndex = (session.dealerIndex + 1) % n;
        utgIndex = sbIndex;
      } else {
        sbIndex = (session.dealerIndex + 1) % n;
        bbIndex = (session.dealerIndex + 2) % n;
        utgIndex = (session.dealerIndex + 3) % n;
      }

      // 1. 스몰 블라인드 강제 베팅
      const sbPlayer = session.players[sbIndex];
      const sbBal = economy.getBalance(sbPlayer.id);
      const sbActual = Math.min(session.sb, sbBal);
      economy.modifyCoins(sbPlayer.id, -sbActual);
      sbPlayer.currentBet = sbActual;
      sbPlayer.totalBet = sbActual;
      if (sbActual < session.sb) sbPlayer.allIn = true;
      session.pot += sbActual;

      // 2. 빅 블라인드 강제 베팅
      const bbPlayer = session.players[bbIndex];
      const bbBal = economy.getBalance(bbPlayer.id);
      const bbActual = Math.min(session.bb, bbBal);
      economy.modifyCoins(bbPlayer.id, -bbActual);
      bbPlayer.currentBet = bbActual;
      bbPlayer.totalBet = bbActual;
      if (bbActual < session.bb) bbPlayer.allIn = true;
      session.pot += bbActual;

      // 프리플랍 초기화
      session.stage = 'PREFLOP';
      session.currentBet = session.bb;
      session.minRaise = session.bb;

      // 올인이 아닌 첫 플레이어 찾기
      let turnIndex = utgIndex;
      let loopCount = 0;
      while (session.players[turnIndex].allIn && loopCount < n) {
        turnIndex = (turnIndex + 1) % n;
        loopCount++;
      }
      session.currentTurnIndex = turnIndex;

      // 만약 블라인드 납부 후 베팅 가능 인원이 1명 이하이면 카드 전부 오픈 후 쇼다운
      const bettableStart = session.players.filter((p) => !p.folded && !p.allIn);
      if (bettableStart.length <= 1) {
        return this.advanceStreet(interaction, session);
      }

      const embed = createGameEmbed(session);
      const row = createTurnButtons(sessionId, session);
      return interaction.update({ embeds: [embed], components: [row] });
    }

    // ==========================================
    // 3. 내 패 확인 (비공개 Ephemeral)
    // ==========================================
    if (action === 'viewhand') {
      const player = session.players.find((p) => p.id === userId);
      if (!player) {
        return interaction.reply({ content: '❌ 이 게임의 참가자가 아닙니다.', ephemeral: true });
      }

      if (player.folded) {
        return interaction.reply({ content: '🏳️ 이미 이번 판에서 기권(폴드)하셨습니다.', ephemeral: true });
      }

      let availableCards = [...player.hand, ...session.communityCards];
      let bestHandText = '';
      if (availableCards.length >= 5) {
        const best = evaluate7Cards(availableCards);
        bestHandText = `\n현재 최선의 족보: **[${best.name}]**`;
      }

      return interaction.reply({
        content: `🤫 **${interaction.user.displayName}** 님의 비밀 홀 카드: ${formatCardsList(player.hand)}${bestHandText}`,
        ephemeral: true,
      });
    }

    // ==========================================
    // 4. 베팅 액션 (체크, 콜, 레이즈, 폴드)
    // ==========================================
    const currentTurnPlayer = session.players[session.currentTurnIndex];
    if (['check', 'call', 'raise', 'allin', 'fold'].includes(action)) {
      if (currentTurnPlayer.id !== userId) {
        console.log(`[홀덤 턴 불일치] 액션: ${action}, 요청자: ${interaction.user.displayName}(${userId}), 현재 턴: ${currentTurnPlayer.name}(${currentTurnPlayer.id}) [인덱스: ${session.currentTurnIndex}]`);
        return interaction.reply({
          content: `⏳ 지금은 **${currentTurnPlayer.name}** 님의 차례입니다! 순서를 기다려주세요.`,
          ephemeral: true,
        });
      }
      console.log(`[홀덤 액션 허용] 액션: ${action}, 실행자: ${currentTurnPlayer.name}(${userId}) [인덱스: ${session.currentTurnIndex}]`);
    }

    // --- [체크 (Check)] ---
    if (action === 'check') {
      const callCost = session.currentBet - currentTurnPlayer.currentBet;
      if (callCost > 0) {
        return interaction.reply({
          content: `❌ 현재 콜해야 할 금액(${callCost.toLocaleString()} 코인)이 있어 체크할 수 없습니다! 콜 또는 폴드를 선택하세요.`,
          ephemeral: true,
        });
      }

      currentTurnPlayer.acted = true;
      return this.advanceTurn(interaction, session);
    }

    // --- [콜 (Call)] ---
    if (action === 'call') {
      const callCost = session.currentBet - currentTurnPlayer.currentBet;
      const actualBet = Math.min(callCost, userBalance);

      if (actualBet > 0) {
        economy.modifyCoins(userId, -actualBet);
        session.pot += actualBet;
        currentTurnPlayer.currentBet += actualBet;
        currentTurnPlayer.totalBet += actualBet;
      }

      if (actualBet < callCost) {
        currentTurnPlayer.allIn = true;
      }

      currentTurnPlayer.acted = true;
      return this.advanceTurn(interaction, session);
    }

    // --- [레이즈 (Raise) - 디스코드 네이티브 모달 팝업] ---
    if (action === 'raise') {
      const modal = new ModalBuilder()
        .setCustomId(`holdem_modal_raise_${sessionId}`)
        .setTitle('♠️ 텍사스 홀덤 레이즈');

      const maxAffordableRaise = Math.max(
        0,
        userBalance - (session.currentBet - currentTurnPlayer.currentBet)
      );

      const amountInput = new TextInputBuilder()
        .setCustomId('raise_amount')
        .setLabel(`추가 레이즈 코인 (보유: ${userBalance.toLocaleString()} 코인)`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`최소: ${session.minRaise.toLocaleString()} ~ 최대: ${maxAffordableRaise.toLocaleString()} 코인`)
        .setValue(String(Math.min(maxAffordableRaise, session.minRaise)))
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(amountInput));
      return interaction.showModal(modal);
    }

    // --- [올인 (All-In)] ---
    if (action === 'allin') {
      const allInAmount = userBalance;
      if (allInAmount <= 0) {
        return interaction.reply({
          content: '❌ 보유 코인이 없어 올인할 수 없습니다!',
          ephemeral: true,
        });
      }

      economy.modifyCoins(userId, -allInAmount);
      session.pot += allInAmount;
      currentTurnPlayer.currentBet += allInAmount;
      currentTurnPlayer.totalBet += allInAmount;
      currentTurnPlayer.allIn = true;
      currentTurnPlayer.acted = true;

      // 올인 베팅액이 기존 기준액보다 크다면 콜 기준액 갱신 및 다른 플레이어 액션 재요구
      if (currentTurnPlayer.currentBet > session.currentBet) {
        const raiseDiff = currentTurnPlayer.currentBet - session.currentBet;
        session.currentBet = currentTurnPlayer.currentBet;
        if (raiseDiff > session.minRaise) {
          session.minRaise = raiseDiff;
        }

        for (const p of session.players) {
          if (!p.folded && !p.allIn && p.id !== userId) {
            p.acted = false;
          }
        }
      }

      return this.advanceTurn(interaction, session);
    }

    // --- [폴드 (Fold)] ---
    if (action === 'fold') {
      currentTurnPlayer.folded = true;
      currentTurnPlayer.acted = true;

      const activePlayers = session.players.filter((p) => !p.folded);
      if (activePlayers.length === 1) {
        return this.finishGameByFold(interaction, session, activePlayers[0]);
      }

      return this.advanceTurn(interaction, session);
    }
  },

  // 시계 방향 턴 넘기기 및 라운드 종료 검증
  async advanceTurn(interaction, session) {
    const activePlayers = session.players.filter((p) => !p.folded);

    // 1명만 남은 경우 즉시 승리
    if (activePlayers.length <= 1) {
      return this.finishGameByFold(interaction, session, activePlayers[0]);
    }

    // 베팅 가능한 플레이어 (폴드 안 함 & 올인 안 함)
    const bettablePlayers = activePlayers.filter((p) => !p.allIn);

    // 라운드 종료 조건:
    // 1) 칩을 걸 수 있는 플레이어가 0명 (전원 올인)이거나,
    // 2) 모든 생존자가 (올인이거나 행동을 마쳤고), 올인하지 않은 모든 플레이어의 베팅액이 최고 베팅액(currentBet)과 일치할 때
    const roundFinished =
      bettablePlayers.length === 0 ||
      (activePlayers.every((p) => p.allIn || p.acted) &&
        bettablePlayers.every((p) => p.currentBet === session.currentBet));

    if (roundFinished) {
      return this.advanceStreet(interaction, session);
    }

    // 시계 방향으로 다음 턴 플레이어 찾기 (루프 카운터로 무한 루프 원천 방지)
    const n = session.players.length;
    let nextIndex = (session.currentTurnIndex + 1) % n;
    let loopCount = 0;
    while (
      (session.players[nextIndex].folded || session.players[nextIndex].allIn) &&
      loopCount < n
    ) {
      nextIndex = (nextIndex + 1) % n;
      loopCount++;
    }

    // 만약 다음 턴을 잡을 플레이어가 없다면(모두 올인/폴드) 라운드 진행
    if (session.players[nextIndex].folded || session.players[nextIndex].allIn) {
      return this.advanceStreet(interaction, session);
    }

    console.log(`[홀덤 턴 넘김] ${session.players[session.currentTurnIndex]?.name}(인덱스 ${session.currentTurnIndex}) -> ${session.players[nextIndex]?.name}(인덱스 ${nextIndex})`);
    session.currentTurnIndex = nextIndex;
    return updateBoardMessage(interaction, session);
  },

  // 다음 스트리트 (프리플랍 -> 플랍 -> 턴 -> 리버 -> 쇼다운)
  async advanceStreet(interaction, session) {
    const activePlayers = session.players.filter((p) => !p.folded);

    // 1. 생존자가 1명 이하이면 즉시 폴드 승리
    if (activePlayers.length <= 1) {
      return this.finishGameByFold(interaction, session, activePlayers[0]);
    }

    const deck = session.deck;

    // 2. 생존자 중 칩을 더 베팅할 수 있는 인원이 1명 이하인 경우 (전원 올인 또는 1명만 칩 남음)
    // 더 이상의 베팅 액션이 불가능하므로 남은 커뮤니티 카드를 즉시 전부 깔고 쇼다운 직행!
    const bettablePlayers = activePlayers.filter((p) => !p.allIn);
    if (bettablePlayers.length <= 1) {
      while (session.communityCards.length < 5) {
        session.burnedCards.push(deck.pop());
        session.communityCards.push(deck.pop());
      }
      session.stage = 'SHOWDOWN';
      return this.finishGameShowdown(interaction, session);
    }

    // 3. 정상적인 다음 스트리트 진행: 라운드 베팅 리셋
    session.currentBet = 0;
    session.minRaise = session.bb; // 다음 라운드 기본 레이즈액 초기화
    for (const p of session.players) {
      p.currentBet = 0;
      p.acted = false;
    }

    // 4. 정통 스트리트 전환 & Burn 카드 규칙
    if (session.stage === 'PREFLOP') {
      session.stage = 'FLOP';
      session.burnedCards.push(deck.pop()); // 플랍 전 1장 태우기(Burn)
      session.communityCards.push(deck.pop(), deck.pop(), deck.pop()); // 3장 오픈
    } else if (session.stage === 'FLOP') {
      session.stage = 'TURN';
      session.burnedCards.push(deck.pop()); // 턴 전 1장 태우기(Burn)
      session.communityCards.push(deck.pop()); // 1장 오픈 (총 4장)
    } else if (session.stage === 'TURN') {
      session.stage = 'RIVER';
      session.burnedCards.push(deck.pop()); // 리버 전 1장 태우기(Burn)
      session.communityCards.push(deck.pop()); // 1장 오픈 (총 5장)
    } else if (session.stage === 'RIVER') {
      session.stage = 'SHOWDOWN';
      return this.finishGameShowdown(interaction, session);
    }

    // 5. 포스트플랍 첫 턴: 정통 룰에 따라 딜러 버튼 바로 왼쪽(SB 위치부터) 시작!
    const n = session.players.length;
    let postflopStartIndex = (session.dealerIndex + 1) % n;
    let loopCount = 0;
    while (
      (session.players[postflopStartIndex].folded ||
        session.players[postflopStartIndex].allIn) &&
      loopCount < n
    ) {
      postflopStartIndex = (postflopStartIndex + 1) % n;
      loopCount++;
    }

    session.currentTurnIndex = postflopStartIndex;
    return updateBoardMessage(interaction, session);
  },

  // 전원 폴드로 인한 승리
  async finishGameByFold(interaction, session, winner) {
    session.stage = 'SHOWDOWN';
    economy.modifyCoins(winner.id, session.pot);

    const winnerText = `🎉 다른 모든 참가자가 기권(폴드)하여 **${winner.name}** 님이 단독 승리하셨습니다!\n💰 획득 총 팟: **${session.pot.toLocaleString()} 코인**`;
    return updateBoardMessage(interaction, session, true, winnerText);
  },

  // 정통 쇼다운: 기여도 비례 메인 팟 & 사이드 팟 분배
  async finishGameShowdown(interaction, session) {
    session.stage = 'SHOWDOWN';

    const activePlayers = session.players.filter((p) => !p.folded);

    // 각 생존 플레이어의 7장 족보 평가
    const evaluatedMap = new Map();
    for (const p of activePlayers) {
      const allCards = [...p.hand, ...session.communityCards];
      evaluatedMap.set(p.id, evaluate7Cards(allCards));
    }

    // 1. 모든 플레이어의 베팅 레벨(Tier) 추출 및 오름차순 정렬
    const betLevels = [
      ...new Set(session.players.map((p) => p.totalBet).filter((b) => b > 0)),
    ].sort((a, b) => a - b);

    // 2. 메인 팟 및 사이드 팟 구간 분리
    const pots = []; // { potName, potAmount, eligible }
    let prevLevel = 0;

    betLevels.forEach((level, idx) => {
      const diff = level - prevLevel;
      if (diff <= 0) return;

      let currentTierAmount = 0;
      for (const p of session.players) {
        if (p.totalBet >= level) {
          currentTierAmount += diff;
        } else if (p.totalBet > prevLevel) {
          currentTierAmount += p.totalBet - prevLevel;
        }
      }

      // 이 구간 팟을 획득할 자격이 있는 플레이어 (폴드 안 했고 이 레벨 이상 참여한 플레이어)
      const eligible = activePlayers.filter((p) => p.totalBet >= level);

      if (currentTierAmount > 0 && eligible.length > 0) {
        pots.push({
          potName: idx === 0 ? '메인 팟 (Main Pot)' : `사이드 팟 ${idx} (Side Pot)`,
          potAmount: currentTierAmount,
          eligible,
        });
      }

      prevLevel = level;
    });

    // 3. 각 팟별 승자 판정 및 상금 배분
    const playerWinnings = new Map();
    for (const p of activePlayers) {
      playerWinnings.set(p.id, 0);
    }

    let potResultsSummary = '';

    pots.forEach((pot) => {
      // 해당 팟의 자격자들 중 최고 족보 찾기
      let bestScore = null;
      for (const p of pot.eligible) {
        const ev = evaluatedMap.get(p.id);
        if (!bestScore || compareScores(ev.score, bestScore) > 0) {
          bestScore = ev.score;
        }
      }

      const winners = pot.eligible.filter(
        (p) => compareScores(evaluatedMap.get(p.id).score, bestScore) === 0
      );

      const share = Math.floor(pot.potAmount / winners.length);
      for (const w of winners) {
        playerWinnings.set(w.id, playerWinnings.get(w.id) + share);
      }

      const winnerNames = winners.map((w) => `**${w.name}**`).join(', ');
      const bestHandName = evaluatedMap.get(winners[0].id).name;
      potResultsSummary += `💰 **${pot.potName}** (${pot.potAmount.toLocaleString()} 코인): ${winnerNames} 승리! [${bestHandName}]\n`;
    });

    // 4. 실제 코인 지급
    for (const [playerId, winAmount] of playerWinnings) {
      if (winAmount > 0) {
        economy.modifyCoins(playerId, winAmount);
      }
    }

    // 5. 총 획득 상금 요약
    let totalWinningsSummary = '\n### 🏆 최종 상금 수령\n';
    for (const p of activePlayers) {
      const won = playerWinnings.get(p.id) || 0;
      if (won > 0) {
        totalWinningsSummary += `🎉 **${p.name}**: **+${won.toLocaleString()} 코인**\n`;
      }
    }

    // 6. 참가자 패 및 족보 공개
    let detailSummary = '\n### 📜 쇼다운 홀 카드 및 완성 족보\n';
    const sortedPlayers = [...activePlayers].sort((a, b) =>
      compareScores(evaluatedMap.get(b.id).score, evaluatedMap.get(a.id).score)
    );

    for (const p of sortedPlayers) {
      const ev = evaluatedMap.get(p.id);
      detailSummary += `👤 **${p.name}** (${p.totalBet.toLocaleString()} 코인 투자): ${formatCardsList(p.hand)} ➔ **${ev.name}**\n`;
    }

    const fullSummary = `${potResultsSummary}${totalWinningsSummary}${detailSummary}`;
    return updateBoardMessage(interaction, session, true, fullSummary);
  },

  // 모달 팝업 제출(레이즈) 처리
  async handleModal(interaction) {
    const parts = interaction.customId.split('_');
    const sessionId = parts[parts.length - 1];
    const session = holdemSessions.get(sessionId);

    if (!session) {
      return interaction.reply({
        content: '⚠️ 만료되었거나 존재하지 않는 홀덤 게임입니다.',
        ephemeral: true,
      });
    }

    const userId = interaction.user.id;
    const currentTurnPlayer = session.players[session.currentTurnIndex];

    if (currentTurnPlayer.id !== userId) {
      return interaction.reply({
        content: '❌ 본인의 차례가 아닙니다!',
        ephemeral: true,
      });
    }

    const inputVal = interaction.fields.getTextInputValue('raise_amount').trim();
    if (!/^\d+$/.test(inputVal)) {
      return interaction.reply({
        content: '❌ 숫자로만 금액을 입력해주세요!',
        ephemeral: true,
      });
    }

    const raiseAmount = parseInt(inputVal, 10);
    if (raiseAmount < session.minRaise) {
      return interaction.reply({
        content: `⚠️ 최소 레이즈 금액은 **+${session.minRaise.toLocaleString()} 코인** 이상이어야 합니다!`,
        ephemeral: true,
      });
    }

    const currentBal = economy.getBalance(userId);
    const targetBet = session.currentBet + raiseAmount;
    const cost = targetBet - currentTurnPlayer.currentBet;

    if (currentBal < cost) {
      return interaction.reply({
        content: `❌ 보유 코인(${currentBal.toLocaleString()} 코인)이 부족합니다! (필요: ${cost.toLocaleString()} 코인)`,
        ephemeral: true,
      });
    }

    economy.modifyCoins(userId, -cost);
    session.pot += cost;
    currentTurnPlayer.currentBet = targetBet;
    currentTurnPlayer.totalBet += cost;
    session.currentBet = targetBet;
    session.minRaise = raiseAmount;
    console.log(`[홀덤 레이즈 성공] 플레이어: ${currentTurnPlayer.name}, 레이즈액: +${raiseAmount}, 총 베팅액: ${targetBet}`);

    // 만약 보유 코인을 전부 걸었다면 올인(All-In) 플래그 설정
    if (cost >= currentBal) {
      currentTurnPlayer.allIn = true;
    }

    // 다른 생존자들 액션 재요구
    for (const p of session.players) {
      if (!p.folded && !p.allIn && p.id !== userId) {
        p.acted = false;
      }
    }

    currentTurnPlayer.acted = true;

    // 모달을 닫고 사용자에게 즉시 확인 응답 전송
    await interaction
      .reply({
        content: `✅ **+${raiseAmount.toLocaleString()} 코인** 레이즈 완료! (현재 콜 기준액: **${targetBet.toLocaleString()} 코인**)`,
        ephemeral: true,
      })
      .catch((e) => console.error('모달 응답 에러 (무시하고 턴 진행):', e));

    return this.advanceTurn(interaction, session);
  },
};

