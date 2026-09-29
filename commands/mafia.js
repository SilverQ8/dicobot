const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

// 진행 중인 마피아 게임 세션 저장소 (메모리)
const mafiaSessions = new Map();

// 직업 이모지, 색상 및 설명
const ROLES = {
  MAFIA: {
    name: '마피아',
    emoji: '🔫',
    team: 'MAFIA',
    color: 0xe74c3c,
    desc: '밤마다 시민 1명을 암살합니다.',
  },
  POLICE: {
    name: '경찰',
    emoji: '🔍',
    team: 'CITIZEN',
    color: 0x3498db,
    desc: '밤마다 생존자 1명의 정체를 수사합니다.',
  },
  DOCTOR: {
    name: '의사',
    emoji: '💉',
    team: 'CITIZEN',
    color: 0x2ecc71,
    desc: '밤마다 생존자 1명을 치료하여 암살로부터 보호합니다.',
  },
  POLITICIAN: {
    name: '정치인',
    emoji: '🎩',
    team: 'CITIZEN',
    color: 0x8e44ad,
    desc: '투표권 2표 행사, 주민 투표로 처형당하지 않는 면책 특권이 있습니다.',
  },
  DETECTIVE: {
    name: '사립탐정',
    emoji: '🕵️',
    team: 'CITIZEN',
    color: 0x16a085,
    desc: '밤마다 생존자 1명을 미행하여 그가 누구에게 능력을 썼는지 알아냅니다.',
  },
  SOLDIER: {
    name: '군인',
    emoji: '🛡️',
    team: 'CITIZEN',
    color: 0xe67e22,
    desc: '마피아의 첫 암살 공격을 방탄 조끼로 1회 자동 방어합니다.',
  },
  MEDIUM: {
    name: '영매',
    emoji: '🔮',
    team: 'CITIZEN',
    color: 0x9b59b6,
    desc: '사망자 전용 비밀 유령방을 열람할 수 있어, 죽은 자들이 나누는 대화와 단서를 실시간으로 엿봅니다.',
  },
  CITIZEN: {
    name: '시민',
    emoji: '👤',
    team: 'CITIZEN',
    color: 0x95a5a6,
    desc: '낮 동안의 추리와 투표로 마피아를 찾아냅니다.',
  },
};

// 직업명 포맷 헬퍼 함수
function getCustomRolesText(customRoles) {
  if (!customRoles || customRoles.length === 0) return '없음';
  return customRoles.map((key) => ROLES[key]?.name || key).join(', ');
}

// 인원수 및 커스텀 설정별 직업 분배 표 (커스텀 직업은 7인 이상 전용)
function assignRoles(playerCount, settings = {}) {
  const roles = [];

  // 기본 필수 구성
  if (playerCount === 4) {
    roles.push(ROLES.MAFIA, ROLES.DOCTOR);
  } else if (playerCount <= 6) {
    roles.push(ROLES.MAFIA, ROLES.POLICE, ROLES.DOCTOR);
  } else if (playerCount <= 9) {
    // 7~9인: 마피아 2명, 경찰 1명, 의사 1명
    roles.push(ROLES.MAFIA, ROLES.MAFIA, ROLES.POLICE, ROLES.DOCTOR);
  } else {
    // 10인 이상: 마피아 3명, 경찰 1명, 의사 1명
    roles.push(ROLES.MAFIA, ROLES.MAFIA, ROLES.MAFIA, ROLES.POLICE, ROLES.DOCTOR);
  }

  // 설정에서 활성화(ON)된 커스텀 특수 직업 우선 투입 (인원수 무관)
  if (Array.isArray(settings.customRoles) && settings.customRoles.length > 0) {
    const specialPool = settings.customRoles.map((key) => ROLES[key]).filter(Boolean);

    // 남은 슬롯에 특수 직업 우선 배정
    while (roles.length < playerCount && specialPool.length > 0) {
      roles.push(specialPool.shift());
    }
  }

  // 나머지 슬롯은 일반 시민으로 채움
  while (roles.length < playerCount) {
    roles.push(ROLES.CITIZEN);
  }

  // Fisher-Yates 셔플
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

// 1. 모든 플레이어 마이크 음소거 (밤 시간)
async function muteAllPlayers(guild, session) {
  if (!guild) return;
  for (const player of session.players) {
    try {
      const member = await guild.members.fetch(player.id).catch(() => null);
      if (member?.voice?.channel) {
        await member.voice.setMute(true).catch(() => {});
      }
    } catch (e) {}
  }
}

// 2. 생존자만 마이크 음소거 해제 (낮 토론 시간) - 사망자는 음소거 유지
async function unmuteAlivePlayers(guild, session) {
  if (!guild) return;
  for (const player of session.players) {
    try {
      const member = await guild.members.fetch(player.id).catch(() => null);
      if (member?.voice?.channel) {
        if (player.isAlive) {
          await member.voice.setMute(false).catch(() => {});
        } else {
          await member.voice.setMute(true).catch(() => {});
        }
      }
    } catch (e) {}
  }
}

// 3. 사망자 발생 시 처리 (마이크 잠금 + 사망자 전용 비밀 텍스트방 열람 권한 부여)
async function handlePlayerDeath(guild, session, deadPlayer) {
  if (!guild || !deadPlayer) return;

  // 음성 마이크 잠금 (사망자는 듣기만 가능)
  try {
    const member = await guild.members.fetch(deadPlayer.id).catch(() => null);
    if (member?.voice?.channel) {
      await member.voice.setMute(true).catch(() => {});
    }
  } catch (e) {}

  // 사망자 전용 텍스트 채널에 권한 부여
  if (session.deadChatChannelId) {
    try {
      const deadChannel = await guild.channels.fetch(session.deadChatChannelId).catch(() => null);
      if (deadChannel) {
        await deadChannel.permissionOverwrites.create(deadPlayer.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }).catch(() => {});

        const roleText = session.settings.revealRoleOnDeath
          ? `(생전 직업: **${deadPlayer.role.emoji} ${deadPlayer.role.name}**)`
          : '';

        await deadChannel.send({
          content: `👻 **${deadPlayer.name}** 님이 유령이 되어 입장하셨습니다! ${roleText}\n이제 이곳에서 다른 사망자들과 진실을 나누며 자유롭게 대화하세요. (생존자들에게는 보이지 않습니다)`
        }).catch(() => {});
      }
    } catch (e) {}
  }
}

// 4. 게임 종료/취소 시 채널 및 음성 상태 복원/정리
async function cleanupGameChannels(guild, session) {
  if (!guild || !session) return;

  // 모든 플레이어 음소거 해제
  for (const player of session.players) {
    try {
      const member = await guild.members.fetch(player.id).catch(() => null);
      if (member?.voice?.channel) {
        await member.voice.setMute(false).catch(() => {});
      }
    } catch (e) {}
  }

  // 임시 음성 채널 삭제
  if (session.voiceChannelId) {
    try {
      const vChan = await guild.channels.fetch(session.voiceChannelId).catch(() => null);
      if (vChan) await vChan.delete().catch(() => {});
    } catch (e) {}
    session.voiceChannelId = null;
  }

  // 사망자 텍스트 채널 삭제
  if (session.deadChatChannelId) {
    try {
      const dChan = await guild.channels.fetch(session.deadChatChannelId).catch(() => null);
      if (dChan) await dChan.delete().catch(() => {});
    } catch (e) {}
    session.deadChatChannelId = null;
  }
}

// 대기실 임베드 생성
function createLobbyEmbed(session) {
  const playerList = session.players
    .map(
      (p, idx) =>
        `${idx + 1}. **${p.name}** ${p.id === session.hostId ? '👑(방장)' : ''}`
    )
    .join('\n');

  const { settings } = session;
  const selfHealText =
    settings.doctorSelfHeal === 'unlimited'
      ? '무제한'
      : settings.doctorSelfHeal === 'once'
      ? '게임당 1회'
      : '불가';

  const customRolesText = getCustomRolesText(settings.customRoles);

  return new EmbedBuilder()
    .setTitle('🕵️‍♂️ 마피아 게임 대기실')
    .setColor(0x34495e)
    .setDescription(
      `**방장**: <@${session.hostId}>\n` +
      `**참가 인원**: **${session.players.length}명** (최소 4명 ~ 최대 12명)\n\n` +
      `### 👥 참가자 명단\n${playerList || '*참가자 없음*'}\n\n` +
      `### ⚙️ 게임 옵션 설정\n` +
      `• 🌙 **첫날 밤 마피아 킬**: \`${settings.firstNightKill ? '허용' : '금지'}\`\n` +
      `• 💉 **의사 자힐(치료) 방식**: \`${selfHealText}\`\n` +
      `• 📜 **사망자 직업 공개 여부**: \`${settings.revealRoleOnDeath ? '공개' : '비공개'}\`\n` +
      `• 🎭 **커스텀 직업 (ON/OFF)**: **${customRolesText}**\n\n` +
      `### 🎧 음성 및 사망자 규칙\n` +
      `• 🎧 **음성 필수**: 참가 시 서버 음성 채널에 접속해 있어야 합니다.\n` +
      `• 🔇 **자동 마이크 제어**: 밤에는 전원 마이크 차단, 낮에는 생존자만 마이크가 열립니다.\n` +
      `• 👻 **사망자 유령방**: 사망자는 음성에서 듣기만 가능하며, 사망자 전용 비밀 채팅방이 열립니다.`
    )
    .setFooter({
      text: '4명 이상 모이면 방장이 [게임 시작]을 누를 수 있습니다. [룰 & 직업 설정]으로 옵션을 변경하세요.',
    });
}

// 대기실 기본 버튼 생성
function createLobbyButtons(session) {
  const sessionId = session.sessionId;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mafia_join_${sessionId}`)
      .setLabel('참가하기 🙋')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mafia_leave_${sessionId}`)
      .setLabel('나가기 🏃')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mafia_settings_${sessionId}`)
      .setLabel('룰 & 직업 설정 ⚙️')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`mafia_start_${sessionId}`)
      .setLabel('게임 시작 🎬')
      .setStyle(ButtonStyle.Danger)
  );
  return [row];
}

// 이미지 스타일 설정 화면 임베드 생성
function createSettingsEmbed(session) {
  const settings = session.tempSettings || session.settings;
  const selfHealText =
    settings.doctorSelfHeal === 'unlimited'
      ? '무제한'
      : settings.doctorSelfHeal === 'once'
      ? '게임당 1회'
      : '불가';

  const customRolesText = getCustomRolesText(settings.customRoles);

  return new EmbedBuilder()
    .setTitle('⚙️ 마피아 게임 옵션 설정')
    .setColor(0x2b2d31)
    .setDescription(
      `🌙 **첫날 밤 마피아 킬** : **${settings.firstNightKill ? '허용' : '금지'}**\n\n` +
      `💉 **의사 자힐(치료) 방식** : **${selfHealText}**\n\n` +
      `📜 **사망자 직업 공개 여부** : **${settings.revealRoleOnDeath ? '공개' : '비공개'}**\n\n` +
      `🎭 **커스텀 직업 (ON/OFF)** : **${customRolesText}**\n\n` +
      `> ⚠️ 저장하지 않고 뒤로가기를 누르면 변경 사항이 사라집니다.`
    );
}

// 이미지 스타일 설정 화면 컴포넌트 생성 (항목 드롭다운 + 값 드롭다운 + 3개 버튼)
function createSettingsComponents(session) {
  const sessionId = session.sessionId;
  const settings = session.tempSettings || session.settings;
  const category = session.currentCategory || 'firstNightKill';

  // 1. 수정할 항목 선택 드롭다운
  const catMenu = new StringSelectMenuBuilder()
    .setCustomId(`mafia_cfg_cat_${sessionId}`)
    .setPlaceholder('수정할 설정 항목을 선택하세요')
    .addOptions([
      {
        label: '첫날 밤 마피아 킬',
        value: 'firstNightKill',
        description: '첫날 밤 암살 허용 여부 설정',
        emoji: '🌙',
        default: category === 'firstNightKill',
      },
      {
        label: '의사 자힐(치료) 방식',
        value: 'doctorSelfHeal',
        description: '의사의 본인 치료 횟수 설정',
        emoji: '💉',
        default: category === 'doctorSelfHeal',
      },
      {
        label: '사망자 직업 공개 여부',
        value: 'revealRoleOnDeath',
        description: '사망/처형 시 직업 공개 여부 설정',
        emoji: '📜',
        default: category === 'revealRoleOnDeath',
      },
      {
        label: '커스텀 직업 선택 (ON/OFF)',
        value: 'customRoles',
        description: '게임에 투입할 커스텀 직업 선택 (다중 선택)',
        emoji: '🎭',
        default: category === 'customRoles',
      },
    ]);

  const row1 = new ActionRowBuilder().addComponents(catMenu);

  // 2. 값 선택 드롭다운 (카테고리에 따라 동적 갱신)
  let valMenu;
  if (category === 'firstNightKill') {
    valMenu = new StringSelectMenuBuilder()
      .setCustomId(`mafia_cfg_val_${sessionId}`)
      .setPlaceholder('어떤 값으로 설정할까요?')
      .addOptions([
        {
          label: '허용',
          value: 'true',
          description: '첫날 밤부터 마피아 암살 가능',
          emoji: '⭕',
          default: settings.firstNightKill === true,
        },
        {
          label: '금지',
          value: 'false',
          description: '첫날 밤에는 암살 불가 (탐색전)',
          emoji: '❌',
          default: settings.firstNightKill === false,
        },
      ]);
  } else if (category === 'doctorSelfHeal') {
    valMenu = new StringSelectMenuBuilder()
      .setCustomId(`mafia_cfg_val_${sessionId}`)
      .setPlaceholder('어떤 값으로 설정할까요?')
      .addOptions([
        {
          label: '무제한',
          value: 'unlimited',
          description: '매일 밤마다 본인 치료 가능',
          emoji: '💉',
          default: settings.doctorSelfHeal === 'unlimited',
        },
        {
          label: '게임당 1회',
          value: 'once',
          description: '게임 전체에서 딱 1번만 본인 치료 가능',
          emoji: '1️⃣',
          default: settings.doctorSelfHeal === 'once',
        },
        {
          label: '불가',
          value: 'none',
          description: '자기 자신은 치료할 수 없음 (타인만 치료)',
          emoji: '❌',
          default: settings.doctorSelfHeal === 'none',
        },
      ]);
  } else if (category === 'revealRoleOnDeath') {
    valMenu = new StringSelectMenuBuilder()
      .setCustomId(`mafia_cfg_val_${sessionId}`)
      .setPlaceholder('어떤 값으로 설정할까요?')
      .addOptions([
        {
          label: '공개',
          value: 'true',
          description: '사망 및 처형 즉시 진짜 직업 공개',
          emoji: '📜',
          default: settings.revealRoleOnDeath === true,
        },
        {
          label: '비공개',
          value: 'false',
          description: '직업을 숨기고 사망 처리만 진행 (추리 난이도 상승)',
          emoji: '🔒',
          default: settings.revealRoleOnDeath === false,
        },
      ]);
  } else {
    // 커스텀 직업 선택 (다중 선택 드롭다운)
    const selectedRoles = settings.customRoles || [];
    valMenu = new StringSelectMenuBuilder()
      .setCustomId(`mafia_cfg_val_${sessionId}`)
      .setPlaceholder('어떤 값으로 설정할까요? (복수 선택 가능)')
      .setMinValues(0)
      .setMaxValues(4)
      .addOptions([
        {
          label: '정치인',
          value: 'POLITICIAN',
          description: '투표권 2표 행사 & 주민 투표 처형 불가',
          emoji: '🎩',
          default: selectedRoles.includes('POLITICIAN'),
        },
        {
          label: '사립탐정',
          value: 'DETECTIVE',
          description: '밤마다 1명을 미행하여 행동 대상 감시',
          emoji: '🕵️',
          default: selectedRoles.includes('DETECTIVE'),
        },
        {
          label: '군인',
          value: 'SOLDIER',
          description: '마피아의 첫 암살 공격을 방탄 조끼로 1회 방어',
          emoji: '🛡️',
          default: selectedRoles.includes('SOLDIER'),
        },
        {
          label: '영매',
          value: 'MEDIUM',
          description: '사망자 전용 비밀 유령방을 엿보아 대화/단서 확인',
          emoji: '🔮',
          default: selectedRoles.includes('MEDIUM'),
        },
      ]);
  }

  const row2 = new ActionRowBuilder().addComponents(valMenu);

  // 3. 하단 액션 버튼 행 (저장, 기본값으로 초기화, 뒤로가기)
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mafia_cfg_save_${sessionId}`)
      .setLabel('저장')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mafia_cfg_reset_${sessionId}`)
      .setLabel('기본값으로 초기화')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`mafia_cfg_back_${sessionId}`)
      .setLabel('뒤로가기')
      .setStyle(ButtonStyle.Danger)
  );

  return [row1, row2, row3];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('마피아')
    .setDescription('마피아 게임 방을 생성하고 플레이합니다.')
    .addSubcommand((sub) =>
      sub.setName('방생성').setDescription('마피아 게임 대기실을 엽니다.')
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const sessionId = interaction.id;

    // 방 생성자(방장)의 음성 채널 접속 여부 확인
    if (!interaction.member?.voice?.channel) {
      return interaction.reply({
        content: '❌ 마피아 게임 방을 생성하려면 먼저 음성 채널에 접속해 있어야 합니다! 🎧',
        ephemeral: true,
      });
    }

    const session = {
      sessionId,
      hostId: userId,
      channelId: interaction.channelId,
      messageId: null,
      voiceChannelId: null, // 임시 음성 채널 ID
      deadChatChannelId: null, // 사망자 전용 텍스트 채널 ID
      stage: 'LOBBY', // LOBBY, NIGHT, DAY_ANNOUNCE, DAY_TALK, VOTING, TRIAL, GAME_OVER
      dayCount: 1,
      players: [
        {
          id: userId,
          name: interaction.user.displayName,
          role: null,
          isAlive: true,
          selfHealUsedCount: 0,
          soldierShieldUsed: false,
        },
      ],
      // 룰 커스텀 및 특수 직업 기본값
      settings: {
        firstNightKill: true, // 첫날 밤 마피아 킬 허용 여부
        doctorSelfHeal: 'unlimited', // unlimited, once, none
        revealRoleOnDeath: true, // 처형/사망 시 직업 공개 여부
        customRoles: ['POLITICIAN', 'SOLDIER'], // 기본 커스텀 직업 (정치인, 군인)
      },
      tempSettings: null, // 설정 메뉴 임시 편집 버퍼
      currentCategory: 'firstNightKill', // 현재 선택된 설정 탭
      // 밤 행동 수집
      nightActions: {
        mafiaTargetId: null,
        doctorTargetId: null,
        policeTargetId: null,
        detectiveTargetId: null,
        detectiveInvestigatorId: null,
        actionsByUser: new Map(), // userId -> targetId
        detectiveReport: null,
      },
      // 낮 투표 수집
      votes: new Map(), // voterId -> targetId
      trialTargetId: null,
      trialVotes: new Map(), // voterId -> boolean (true: 처형 찬성, false: 반대)
      timer: null,
    };

    mafiaSessions.set(sessionId, session);

    const embed = createLobbyEmbed(session);
    const rows = createLobbyButtons(session);

    const replyMsg = await interaction.reply({
      embeds: [embed],
      components: rows,
      fetchReply: true,
    });

    session.messageId = replyMsg.id;
  },

  // 미니게임 드롭다운 메뉴에서 마피아를 선택했을 때 대기실 생성
  async startFromSelect(interaction) {
    const userId = interaction.user.id;
    const sessionId = interaction.id;

    // 방 생성자(방장)의 음성 채널 접속 여부 확인
    if (!interaction.member?.voice?.channel) {
      return interaction.reply({
        content: '❌ 마피아 게임 방을 생성하려면 먼저 음성 채널에 접속해 있어야 합니다! 🎧',
        ephemeral: true,
      });
    }

    const session = {
      sessionId,
      hostId: userId,
      channelId: interaction.channelId,
      messageId: interaction.message?.id || null,
      voiceChannelId: null, // 임시 음성 채널 ID
      deadChatChannelId: null, // 사망자 전용 텍스트 채널 ID
      stage: 'LOBBY',
      dayCount: 1,
      players: [
        {
          id: userId,
          name: interaction.user.displayName,
          role: null,
          isAlive: true,
          selfHealUsedCount: 0,
          soldierShieldUsed: false,
        },
      ],
      settings: {
        firstNightKill: true,
        doctorSelfHeal: 'unlimited',
        revealRoleOnDeath: true,
        customRoles: ['POLITICIAN', 'SOLDIER'],
      },
      tempSettings: null,
      currentCategory: 'firstNightKill',
      nightActions: {
        mafiaTargetId: null,
        doctorTargetId: null,
        policeTargetId: null,
        detectiveTargetId: null,
        detectiveInvestigatorId: null,
        actionsByUser: new Map(),
        detectiveReport: null,
      },
      votes: new Map(),
      trialTargetId: null,
      trialVotes: new Map(),
      timer: null,
    };

    mafiaSessions.set(sessionId, session);

    const embed = createLobbyEmbed(session);
    const rows = createLobbyButtons(session);

    // 드롭다운 메뉴 메시지를 마피아 대기실로 즉시 전환
    await interaction.update({
      embeds: [embed],
      components: rows,
    });
  },

  // 버튼 인터랙션 처리기
  async handleButton(interaction) {
    const parts = interaction.customId.split('_');
    const action = parts[1];

    if (action === 'restart') {
      return this.startFromSelect(interaction);
    }

    const p3 = parts[2];
    const p4 = parts[3];
    const sessionId = p4 || p3;
    const session = mafiaSessions.get(sessionId);

    if (!session) {
      return interaction.reply({
        content: '⚠️ 만료되었거나 존재하지 않는 마피아 게임입니다.',
        ephemeral: true,
      });
    }

    const userId = interaction.user.id;

    // ==========================================
    // 1. 대기실 인터랙션 (참가/퇴장/룰설정/시작)
    // ==========================================
    if (action === 'join') {
      if (session.stage !== 'LOBBY') {
        return interaction.reply({ content: '❌ 이미 게임이 시작되었습니다.', ephemeral: true });
      }
      if (session.players.some((p) => p.id === userId)) {
        return interaction.reply({ content: '⚠️ 이미 참가 중입니다!', ephemeral: true });
      }
      if (session.players.length >= 12) {
        return interaction.reply({ content: '❌ 최대 참가 인원(12명)이 꽉 찼습니다.', ephemeral: true });
      }
      if (!interaction.member?.voice?.channel) {
        return interaction.reply({
          content: '❌ 마피아 게임에 참가하려면 먼저 음성 채널에 접속해 있어야 합니다! 🎧',
          ephemeral: true,
        });
      }

      session.players.push({
        id: userId,
        name: interaction.user.displayName,
        role: null,
        isAlive: true,
        selfHealUsedCount: 0,
      });

      const embed = createLobbyEmbed(session);
      return interaction.update({ embeds: [embed] });
    }

    if (action === 'leave') {
      if (session.stage !== 'LOBBY') {
        return interaction.reply({ content: '❌ 게임이 진행 중일 때는 나갈 수 없습니다.', ephemeral: true });
      }
      const idx = session.players.findIndex((p) => p.id === userId);
      if (idx === -1) {
        return interaction.reply({ content: '⚠️ 참가 중이 아닙니다.', ephemeral: true });
      }

      session.players.splice(idx, 1);

      if (session.players.length === 0) {
        await cleanupGameChannels(interaction.guild, session);
        mafiaSessions.delete(sessionId);
        const replayRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('mafia_restart')
            .setLabel('마피아 대기실 다시 생성 🕵️‍♂️')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('minigame_lobby')
            .setLabel('미니게임 목록 🎮')
            .setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({
          content: '🚪 모든 참가자가 퇴장하여 방이 닫혔습니다.',
          embeds: [],
          components: [replayRow],
        });
      }

      if (session.hostId === userId) {
        session.hostId = session.players[0].id;
      }

      const embed = createLobbyEmbed(session);
      return interaction.update({ embeds: [embed] });
    }

    // --- 룰 & 직업 설정 화면 진입 ---
    if (action === 'settings') {
      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 설정을 변경할 수 있습니다!', ephemeral: true });
      }
      session.tempSettings = JSON.parse(JSON.stringify(session.settings));
      session.currentCategory = 'firstNightKill';
      const embed = createSettingsEmbed(session);
      const components = createSettingsComponents(session);
      return interaction.update({ embeds: [embed], components });
    }

    // --- 설정 저장 ---
    if (action === 'cfg' && p3 === 'save') {
      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 설정을 저장할 수 있습니다!', ephemeral: true });
      }
      if (session.tempSettings) {
        session.settings = JSON.parse(JSON.stringify(session.tempSettings));
      }
      session.tempSettings = null;
      const embed = createLobbyEmbed(session);
      const rows = createLobbyButtons(session);
      return interaction.update({ embeds: [embed], components: rows });
    }

    // --- 설정 기본값 초기화 ---
    if (action === 'cfg' && p3 === 'reset') {
      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 설정을 초기화할 수 있습니다!', ephemeral: true });
      }
      session.tempSettings = {
        firstNightKill: true,
        doctorSelfHeal: 'unlimited',
        revealRoleOnDeath: true,
        customRoles: ['POLITICIAN', 'SOLDIER'],
      };
      const embed = createSettingsEmbed(session);
      const components = createSettingsComponents(session);
      return interaction.update({ embeds: [embed], components });
    }

    // --- 설정 뒤로가기 (저장하지 않고 메인 대기실 복귀) ---
    if ((action === 'cfg' && p3 === 'back') || action === 'back') {
      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 대기실로 돌아갈 수 있습니다!', ephemeral: true });
      }
      session.tempSettings = null;
      const embed = createLobbyEmbed(session);
      const rows = createLobbyButtons(session);
      return interaction.update({ embeds: [embed], components: rows });
    }

    // --- 게임 시작 ---
    if (action === 'start') {
      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 게임을 시작할 수 있습니다!', ephemeral: true });
      }
      if (session.players.length < 4) {
        return interaction.reply({
          content: '❌ 마피아 게임을 시작하려면 **최소 4명 이상의 플레이어**가 필요합니다!',
          ephemeral: true,
        });
      }

      // 1. 모든 참가자의 음성 채널 접속 여부 재확인
      const guild = interaction.guild;
      const notInVoice = [];
      for (const p of session.players) {
        const mem = await guild.members.fetch(p.id).catch(() => null);
        if (!mem?.voice?.channel) {
          notInVoice.push(p.name);
        }
      }

      if (notInVoice.length > 0) {
        return interaction.reply({
          content: `❌ 다음 참가자가 음성 채널에 접속해 있지 않습니다:\n• **${notInVoice.join('**, **')}**\n모든 참가자가 음성 채널에 접속해야 게임을 시작할 수 있습니다! 🎧`,
          ephemeral: true,
        });
      }

      // 2. 임시 음성 채널 및 사망자 전용 비밀 채팅방 개설
      try {
        const categoryId = interaction.channel.parentId;

        // 임시 음성 채널 생성
        const voiceChannel = await guild.channels.create({
          name: '🕵️ 마피아-게임방',
          type: ChannelType.GuildVoice,
          parent: categoryId || undefined,
        });
        session.voiceChannelId = voiceChannel.id;

        // 사망자 전용 텍스트 채널 생성 (@everyone 차단, 봇만 기본 열람)
        const deadChatChannel = await guild.channels.create({
          name: '👻-마피아-사망자-유령방',
          type: ChannelType.GuildText,
          parent: categoryId || undefined,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              deny: [PermissionFlagsBits.ViewChannel],
            },
            {
              id: interaction.client.user.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
            },
          ],
        });
        session.deadChatChannelId = deadChatChannel.id;

        // 사망자 채널 초기 웰컴 안내 메시지
        await deadChatChannel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle('👻 마피아 사망자(유령) 전용 비밀 채팅방')
              .setColor(0x7f8c8d)
              .setDescription(
                '이곳은 게임 중 사망한 플레이어들만 볼 수 있는 비밀 공간입니다.\n\n' +
                '• **음성 채널**: 마이크가 꺼진 상태로 생존자들의 대화를 청취할 수 있습니다.\n' +
                '• **유령 채팅**: 이곳에서 다른 사망자들과 진실을 밝히며 자유롭게 대화할 수 있습니다!\n' +
                '*(생존자들에게는 이 채널이 보이지 않지만, 🔮 영매는 산 자의 몸으로 이 방의 목소리를 엿듣고 있을 수 있습니다...)*'
              ),
          ],
        });

        // 참가자 전원 임시 음성 채널로 일괄 이동
        for (const p of session.players) {
          const mem = await guild.members.fetch(p.id).catch(() => null);
          if (mem?.voice?.channel) {
            await mem.voice.setChannel(voiceChannel).catch(() => {});
          }
        }
      } catch (err) {
        console.error('마피아 음성/채팅 채널 생성 및 이동 오류:', err);
      }

      // 직업 무작위 배정 (커스텀 직업은 7인 이상일 때만 반영)
      const assignedRoles = assignRoles(session.players.length, session.settings);
      session.players.forEach((p, i) => {
        p.role = assignedRoles[i];
        p.isAlive = true;
        p.selfHealUsedCount = 0;
        p.soldierShieldUsed = false;
      });

      // 🔮 영매(Medium)가 배정된 경우, 살아있는 상태에서도 사망자 유령방을 엿볼 수 있도록 권한 부여
      const mediumPlayer = session.players.find((p) => p.role === ROLES.MEDIUM);
      if (mediumPlayer && session.deadChatChannelId) {
        try {
          const deadChannel = await guild.channels.fetch(session.deadChatChannelId).catch(() => null);
          if (deadChannel) {
            await deadChannel.permissionOverwrites.create(mediumPlayer.id, {
              ViewChannel: true,
              ReadMessageHistory: true,
              SendMessages: false, // 살아있는 동안은 읽기 전용 (영혼의 목소리 엿듣기)
            }).catch(() => {});
          }
        } catch (e) {}
      }

      session.stage = 'NIGHT';
      session.dayCount = 1;

      return this.startNight(interaction, session);
    }

    // --- 사립탐정 미행 보고서 확인 버튼 ---
    if (action === 'detectivereport') {
      const player = session.players.find((p) => p.id === userId);
      if (!player) return interaction.reply({ content: '❌ 게임 참가자가 아닙니다.', ephemeral: true });
      if (player.role !== ROLES.DETECTIVE) {
        return interaction.reply({ content: '❌ 사립탐정만 미행 보고서를 열람할 수 있습니다!', ephemeral: true });
      }
      const report = session.nightActions.detectiveReport || '🔍 아직 밤이 지나지 않아 작성된 미행 보고서가 없습니다.';
      return interaction.reply({ content: report, ephemeral: true });
    }

    // ==========================================
    // 2. 내 직업 확인 버튼
    // ==========================================
    if (action === 'checkrole') {
      const player = session.players.find((p) => p.id === userId);
      if (!player) {
        return interaction.reply({ content: '❌ 이 게임의 참가자가 아닙니다.', ephemeral: true });
      }

      let extraInfo = '';
      if (player.role === ROLES.MAFIA) {
        const otherMafias = session.players
          .filter((p) => p.role === ROLES.MAFIA && p.id !== player.id)
          .map((p) => `**${p.name}**`);
        if (otherMafias.length > 0) {
          extraInfo = `\n🤝 동료 마피아: ${otherMafias.join(', ')}`;
        }
      }

      let reportInfo = '';
      if (player.role === ROLES.DETECTIVE && session.nightActions.detectiveReport) {
        reportInfo = `\n\n${session.nightActions.detectiveReport}`;
      }

      return interaction.reply({
        content:
          `🤫 **${player.name}** 님의 직업은 **${player.role.emoji} ${player.role.name}** 입니다!${extraInfo}\n` +
          `진영: **${player.role.team === 'MAFIA' ? '마피아 진영 🔫' : '시민 진영 🏛️'}**\n` +
          `능력: *${player.role.desc}*${reportInfo}`,
        ephemeral: true,
      });
    }

    // ==========================================
    // 3. 밤 능력 사용 버튼 (모달/메뉴 호출)
    // ==========================================
    if (action === 'useability') {
      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) {
        return interaction.reply({ content: '❌ 생존자만 능력을 사용할 수 있습니다.', ephemeral: true });
      }
      if (session.stage !== 'NIGHT') {
        return interaction.reply({ content: '❌ 밤에만 능력을 사용할 수 있습니다.', ephemeral: true });
      }

      // 시민인 경우
      if (player.role === ROLES.CITIZEN) {
        return interaction.reply({
          content: '💤 당신은 평범한 시민입니다. 밤에는 조용히 잠을 자야 합니다.',
          ephemeral: true,
        });
      }

      // 정치인인 경우 (투표 2표 & 처형 불가 패시브)
      if (player.role === ROLES.POLITICIAN) {
        return interaction.reply({
          content:
            `🎩 **정치인 특권**: 투표권 2표를 행사하며, 주민 투표로 처형당하지 않는 면책 특권이 있습니다.\n` +
            `*밤에는 별도의 행동을 하지 않고 편안히 잠을 잡니다.*`,
          ephemeral: true,
        });
      }

      // 사립탐정인 경우 (미행 대상 지목)
      if (player.role === ROLES.DETECTIVE) {
        const aliveOthers = session.players.filter((p) => p.isAlive && p.id !== player.id);
        if (aliveOthers.length === 0) {
          return interaction.reply({
            content: '⚠️ 미행할 수 있는 다른 생존자가 없습니다.',
            ephemeral: true,
          });
        }

        const detectiveOptions = aliveOthers.map((p) => ({
          label: p.name,
          value: p.id,
          description: '오늘 밤 이 사람을 미행하여 누구에게 능력을 쓰는지 감시합니다.',
        }));

        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId(`mafia_detective_${sessionId}`)
          .setPlaceholder('미행할 주민을 선택하세요')
          .addOptions(detectiveOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({
          content: '🕵️ 오늘 밤 미행할 대상을 선택해 주세요:',
          components: [row],
          ephemeral: true,
        });
      }

      // 군인인 경우 (패시브 방탄 능력)
      if (player.role === ROLES.SOLDIER) {
        const shieldStatus = player.soldierShieldUsed
          ? '방탄 조끼를 이미 소모했습니다. (다음 피격 시 사망)'
          : '방탄 조끼가 건재합니다! (마피아의 첫 암살 공격을 1회 자동 방어)';
        return interaction.reply({
          content:
            `🛡️ **군인 방탄 상태**: ${shieldStatus}\n` +
            `*별도의 밤 조작 없이 마피아가 습격해올 때 자동으로 방탄복이 작동합니다.*`,
          ephemeral: true,
        });
      }

      // 영매인 경우 (사망자 유령 채팅방 엿보기 패시브)
      if (player.role === ROLES.MEDIUM) {
        return interaction.reply({
          content:
            `🔮 **영매의 신비로운 능력**: 당신은 산 자이지만 **사망자 전용 비밀 유령방**을 상시 엿볼 수 있습니다!\n\n` +
            `채널 목록의 **[👻-마피아-사망자-유령방]**을 확인하여, 먼저 떠난 영혼들이 나누는 진실과 마피아 단서를 살펴보세요.\n` +
            `*(살아있는 동안에는 영혼의 소리를 엿듣기만 가능하며, 밤에 별도의 버튼 조작 없이 상시 발동됩니다)*`,
          ephemeral: true,
        });
      }

      // 첫날 밤 킬 금지 룰 검증
      if (player.role === ROLES.MAFIA && session.dayCount === 1 && !session.settings.firstNightKill) {
        return interaction.reply({
          content: '🕊️ [룰 설정] 첫날 밤에는 마피아 암살이 금지되어 있습니다. 이번 밤은 쉬어갑니다.',
          ephemeral: true,
        });
      }

      // 의사 자힐 검증
      const alivePlayers = session.players.filter((p) => p.isAlive);
      const options = alivePlayers
        .filter((target) => {
          if (player.role === ROLES.DOCTOR) {
            if (target.id === player.id) {
              if (session.settings.doctorSelfHeal === 'none') return false;
              if (session.settings.doctorSelfHeal === 'once' && player.selfHealUsedCount >= 1) return false;
            }
          }
          return true;
        })
        .map((p) => ({
          label: p.name,
          value: p.id,
          description: player.id === p.id ? '(자기 자신)' : '',
        }));

      if (options.length === 0) {
        return interaction.reply({
          content: '⚠️ 선택할 수 있는 대상이 없습니다.',
          ephemeral: true,
        });
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`mafia_target_${sessionId}`)
        .setPlaceholder(`능력을 적용할 플레이어를 선택하세요`)
        .addOptions(options);

      const row = new ActionRowBuilder().addComponents(selectMenu);

      return interaction.reply({
        content: `🎯 **${player.role.emoji} ${player.role.name}** 능력을 적용할 대상을 선택해 주세요:`,
        components: [row],
        ephemeral: true,
      });
    }

    // ==========================================
    // 4. 낮 토론 건너뛰기 / 투표 진행 버튼
    // ==========================================
    if (action === 'startvote') {
      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) {
        return interaction.reply({ content: '❌ 생존자만 투표를 개시할 수 있습니다.', ephemeral: true });
      }
      return this.startVoting(interaction, session);
    }

    // ==========================================
    // 5. 처형 찬반 투표 버튼
    // ==========================================
    if (action === 'judgement') {
      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) {
        return interaction.reply({ content: '❌ 생존자만 투표할 수 있습니다.', ephemeral: true });
      }
      if (player.id === session.trialTargetId) {
        return interaction.reply({ content: '❌ 피고인은 본인의 처형 투표에 참여할 수 없습니다!', ephemeral: true });
      }

      const choice = p3 === 'yes'; // yes or no
      session.trialVotes.set(userId, choice);

      await interaction.reply({
        content: `⚖️ 처형에 **${choice ? '찬성 ⚔️' : '반대 🕊️'}** 투표하셨습니다.`,
        ephemeral: true,
      });

      // 생존자 전원 투표 완료 여부 확인
      const aliveVoters = session.players.filter((p) => p.isAlive && p.id !== session.trialTargetId);
      if (session.trialVotes.size >= aliveVoters.length) {
        return this.finishJudgement(interaction, session);
      }
    }

    // --- 아침 맞이하기 (밤 종료) ---
    if (action === 'dawn') {
      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) return;
      return this.startDay(interaction, session);
    }

    // --- 1차 투표 조기 집계 ---
    if (action === 'finishvote') {
      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) return;
      return this.finishVoting(interaction, session);
    }

    // --- 재판 찬반 투표 조기 집계 ---
    if (action === 'finishjudge') {
      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) return;
      return this.finishJudgement(interaction, session);
    }

    // ==========================================
    // 6. 다음 밤으로 바로 진행
    // ==========================================
    if (action === 'nextnight') {
      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) return;
      session.dayCount++;
      return this.startNight(interaction, session);
    }
  },

  // 셀렉트 메뉴 인터랙션 처리기 (설정 드롭다운, 밤 능력 대상 선택 & 낮 1차 지목 투표)
  async handleSelectMenu(interaction) {
    const customId = interaction.customId;
    const userId = interaction.user.id;

    // --- 0-1. 설정 항목 카테고리 선택 드롭다운 ---
    if (customId.startsWith('mafia_cfg_cat_')) {
      const sessionId = customId.replace('mafia_cfg_cat_', '');
      const session = mafiaSessions.get(sessionId);
      if (!session) return interaction.reply({ content: '만료된 세션입니다.', ephemeral: true });

      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 설정을 조작할 수 있습니다!', ephemeral: true });
      }

      session.currentCategory = interaction.values[0];
      const embed = createSettingsEmbed(session);
      const components = createSettingsComponents(session);
      return interaction.update({ embeds: [embed], components });
    }

    // --- 0-2. 설정 값 변경 드롭다운 ---
    if (customId.startsWith('mafia_cfg_val_')) {
      const sessionId = customId.replace('mafia_cfg_val_', '');
      const session = mafiaSessions.get(sessionId);
      if (!session) return interaction.reply({ content: '만료된 세션입니다.', ephemeral: true });

      if (session.hostId !== userId) {
        return interaction.reply({ content: '❌ 방장만 설정을 조작할 수 있습니다!', ephemeral: true });
      }

      if (!session.tempSettings) {
        session.tempSettings = JSON.parse(JSON.stringify(session.settings));
      }

      const category = session.currentCategory || 'firstNightKill';
      if (category === 'firstNightKill') {
        session.tempSettings.firstNightKill = interaction.values[0] === 'true';
      } else if (category === 'doctorSelfHeal') {
        session.tempSettings.doctorSelfHeal = interaction.values[0];
      } else if (category === 'revealRoleOnDeath') {
        session.tempSettings.revealRoleOnDeath = interaction.values[0] === 'true';
      } else if (category === 'customRoles') {
        // 다중 선택 결과 반영
        session.tempSettings.customRoles = interaction.values;
      }

      const embed = createSettingsEmbed(session);
      const components = createSettingsComponents(session);
      return interaction.update({ embeds: [embed], components });
    }

    // --- 1. 밤 능력 대상 선택 (마피아, 의사, 경찰) ---
    if (customId.startsWith('mafia_target_')) {
      const sessionId = customId.replace('mafia_target_', '');
      const session = mafiaSessions.get(sessionId);
      if (!session) return interaction.reply({ content: '만료된 세션입니다.', ephemeral: true });

      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) return;

      const targetId = interaction.values[0];
      const targetPlayer = session.players.find((p) => p.id === targetId);

      // 사립탐정 감시를 위해 행동 주체와 대상 기록
      session.nightActions.actionsByUser.set(userId, targetId);

      if (player.role === ROLES.MAFIA) {
        session.nightActions.mafiaTargetId = targetId;
        return interaction.update({
          content: `🔫 오늘 밤 암살 타겟으로 **${targetPlayer.name}** 님을 지목했습니다.`,
          components: [],
        });
      } else if (player.role === ROLES.DOCTOR) {
        session.nightActions.doctorTargetId = targetId;
        if (targetId === player.id) {
          player.selfHealUsedCount++;
        }
        return interaction.update({
          content: `💉 오늘 밤 치료 대상으로 **${targetPlayer.name}** 님을 선택했습니다.`,
          components: [],
        });
      } else if (player.role === ROLES.POLICE) {
        session.nightActions.policeTargetId = targetId;
        const isMafia = targetPlayer.role === ROLES.MAFIA;
        return interaction.update({
          content: `🔍 수사 결과: **${targetPlayer.name}** 님은 **${isMafia ? '🔴 [마피아]' : '🟢 [시민(마피아 아님)]'}** 입니다!`,
          components: [],
        });
      }
    }

    // --- 1-2. 사립탐정 미행 대상 선택 ---
    if (customId.startsWith('mafia_detective_')) {
      const sessionId = customId.replace('mafia_detective_', '');
      const session = mafiaSessions.get(sessionId);
      if (!session) return interaction.reply({ content: '만료된 세션입니다.', ephemeral: true });

      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) return;

      const targetId = interaction.values[0];
      const targetPlayer = session.players.find((p) => p.id === targetId);

      session.nightActions.detectiveTargetId = targetId;
      session.nightActions.detectiveInvestigatorId = userId;
      session.nightActions.actionsByUser.set(userId, targetId);

      return interaction.update({
        content: `🕵️ 오늘 밤 **${targetPlayer.name}** 님을 은밀하게 미행합니다.\n아침이 오면 그가 누구를 찾아가 능력을 썼는지 조사 보고서가 전달됩니다!`,
        components: [],
      });
    }


    // --- 2. 낮 1차 지목 투표 ---
    if (customId.startsWith('mafia_vote_')) {
      const sessionId = customId.replace('mafia_vote_', '');
      const session = mafiaSessions.get(sessionId);
      if (!session) return interaction.reply({ content: '만료된 세션입니다.', ephemeral: true });

      const player = session.players.find((p) => p.id === userId);
      if (!player || !player.isAlive) {
        return interaction.reply({ content: '❌ 생존자만 투표할 수 있습니다.', ephemeral: true });
      }

      const targetId = interaction.values[0];
      const targetPlayer = session.players.find((p) => p.id === targetId);

      session.votes.set(userId, targetId);

      const voteWeightText = player.role === ROLES.POLITICIAN ? ' (🎩정치인 2표 행사)' : '';
      await interaction.reply({
        content: `🗳️ **${targetPlayer.name}** 님에게 마피아 의심 투표를 완료했습니다.${voteWeightText}`,
        ephemeral: true,
      });

      // 생존자 전원 투표 완료 시 즉시 집계
      const alivePlayers = session.players.filter((p) => p.isAlive);
      if (session.votes.size >= alivePlayers.length) {
        return this.finishVoting(interaction, session);
      }
    }
  },

  // =========================================================================
  // 게임 라이프사이클 메서드들 (밤 -> 낮 -> 투표 -> 재판 -> 밤)
  // =========================================================================

  // 1. 밤 (Night) 시작
  async startNight(interaction, session) {
    session.stage = 'NIGHT';
    session.nightActions = {
      mafiaTargetId: null,
      doctorTargetId: null,
      policeTargetId: null,
      detectiveTargetId: null,
      detectiveInvestigatorId: null,
      actionsByUser: new Map(),
      detectiveReport: null,
    };

    // 밤이 되면 전원 마이크 차단 (서버 음소거)
    await muteAllPlayers(interaction.guild, session);

    const aliveList = session.players
      .filter((p) => p.isAlive)
      .map((p) => `• **${p.name}**`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`🌙 ${session.dayCount}번째 밤이 찾아왔습니다...`)
      .setColor(0x2c3e50)
      .setDescription(
        `마을에 어둠이 깔리고 모든 주민들이 잠에 듭니다.\n` +
        `🔇 **마이크 잠금**: 밤에는 대화가 불가하도록 모든 플레이어의 마이크가 닫힙니다.\n` +
        `각 직업은 아래 **[능력 사용하기 🎯]** 버튼을 눌러 밤의 행동을 수행하세요!\n\n` +
        `### 👥 현재 생존자\n${aliveList}`
      )
      .setFooter({ text: '모든 직업이 행동을 마치거나 [아침 맞이하기]를 누르면 아침이 밝아옵니다.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mafia_checkrole_${session.sessionId}`)
        .setLabel('내 직업 확인 👁️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mafia_useability_${session.sessionId}`)
        .setLabel('능력 사용하기 🎯')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`mafia_dawn_${session.sessionId}`)
        .setLabel('아침 맞이하기 ☀️')
        .setStyle(ButtonStyle.Success)
    );

    if (interaction.replied || interaction.deferred) {
      await interaction.message.edit({ embeds: [embed], components: [row] });
    } else {
      await interaction.update({ embeds: [embed], components: [row] });
    }
  },

  // 2. 아침 (Day) 시작 및 밤 결과 발표
  async startDay(interaction, session) {
    session.stage = 'DAY_TALK';

    const { mafiaTargetId, doctorTargetId, detectiveTargetId, detectiveInvestigatorId, actionsByUser } = session.nightActions;
    let victim = null;
    let soldierDefended = false;

    // 사립탐정 미행 보고서 작성
    if (detectiveTargetId && detectiveInvestigatorId) {
      const spiedPlayer = session.players.find((p) => p.id === detectiveTargetId);
      const usedTargetId = actionsByUser.get(detectiveTargetId);
      if (usedTargetId) {
        const usedTargetPlayer = session.players.find((p) => p.id === usedTargetId);
        session.nightActions.detectiveReport = `🕵️ **사립탐정 미행 보고서**:\n당신이 미행한 **${spiedPlayer ? spiedPlayer.name : '대상'}** 님은 오늘 밤 **${usedTargetPlayer ? usedTargetPlayer.name : '누군가'}** 님을 찾아가 능력을 사용했습니다! *(능력의 종류는 알 수 없습니다)*`;
      } else {
        session.nightActions.detectiveReport = `🕵️ **사립탐정 미행 보고서**:\n당신이 미행한 **${spiedPlayer ? spiedPlayer.name : '대상'}** 님은 오늘 밤 아무에게도 능력을 사용하지 않았습니다. *(조용히 잠을 잤습니다)*`;
      }
    }

    // 마피아가 타겟을 정했고 의사가 살리지 못했을 때 사망 판정
    if (mafiaTargetId) {
      if (mafiaTargetId !== doctorTargetId) {
        const targetPlayer = session.players.find((p) => p.id === mafiaTargetId);
        if (targetPlayer) {
          // 군인의 첫 피격 방탄 조끼 자동 방어
          if (targetPlayer.role === ROLES.SOLDIER && !targetPlayer.soldierShieldUsed) {
            targetPlayer.soldierShieldUsed = true;
            soldierDefended = true;
          } else {
            victim = targetPlayer;
            victim.isAlive = false;
            // 사망자 처리 (음성 마이크 잠금 + 유령방 초대)
            await handlePlayerDeath(interaction.guild, session, victim);
          }
        }
      }
    }

    // 사망 결과 브리핑 문구
    let briefingText = '';
    if (victim) {
      const roleReveal = session.settings.revealRoleOnDeath
        ? ` (그의 정체는 **${victim.role.emoji} ${victim.role.name}** 였습니다)`
        : '';
      briefingText = `💀 **비극적인 소식입니다.**\n지난밤 마피아의 잔혹한 습격으로 **${victim.name}** 님이 처참하게 살해당했습니다...${roleReveal}`;
    } else if (soldierDefended) {
      briefingText = `🛡️ **어젯밤 총성이 울렸지만 아무도 사망하지 않았습니다!**\n마피아가 군인을 습격했으나, 군인의 **방탄 조끼**가 암살 공격을 막아냈습니다!`;
    } else if (mafiaTargetId && mafiaTargetId === doctorTargetId) {
      briefingText = `✨ **평화로운 아침입니다!**\n의사의 헌신적인 치료 덕분에 지난밤에는 아무도 목숨을 잃지 않았습니다!`;
    } else {
      briefingText = `🕊️ 지난밤에는 아무런 습격 사건 없이 평화로운 아침을 맞이했습니다.`;
    }

    // 낮 토론 시작: 생존자만 마이크 음소거 해제, 사망자는 잠금 유지
    await unmuteAlivePlayers(interaction.guild, session);

    // 승리 조건 검증
    const winResult = this.checkWinCondition(session);
    if (winResult) {
      return this.endGame(interaction, session, winResult);
    }

    const aliveList = session.players
      .filter((p) => p.isAlive)
      .map((p) => `• **${p.name}**`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(`☀️ 제 ${session.dayCount}일의 아침이 밝았습니다!`)
      .setColor(0xf39c12)
      .setDescription(
        `${briefingText}\n\n` +
        `### 👥 현재 생존 주민 (${session.players.filter((p) => p.isAlive).length}명)\n${aliveList}\n\n` +
        `🎙️ **생존자 마이크 오픈**: 토론을 통해 서로의 알리바이와 단서로 마피아를 추리하세요!\n` +
        `👻 *(사망자는 마이크가 잠긴 채 청취만 가능하며, 사망자 전용 유령방 채팅을 이용해주세요)*\n\n` +
        `토론을 마치고 마피아를 지목하려면 아래 **[투표 시작 🗳️]** 버튼을 누르세요.`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mafia_checkrole_${session.sessionId}`)
        .setLabel('내 직업 확인 👁️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`mafia_detectivereport_${session.sessionId}`)
        .setLabel('탐정 보고서 🕵️')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`mafia_startvote_${session.sessionId}`)
        .setLabel('투표 시작 🗳️')
        .setStyle(ButtonStyle.Danger)
    );

    if (interaction.replied || interaction.deferred) {
      await interaction.message.edit({ embeds: [embed], components: [row] });
    } else {
      await interaction.update({ embeds: [embed], components: [row] });
    }
  },

  // 3. 1차 지목 투표 시작
  async startVoting(interaction, session) {
    session.stage = 'VOTING';
    session.votes.clear();

    const alivePlayers = session.players.filter((p) => p.isAlive);
    const options = alivePlayers.map((p) => ({
      label: p.name,
      value: p.id,
      description: '마피아로 지목하여 재판에 넘깁니다.',
    }));

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`mafia_vote_${session.sessionId}`)
      .setPlaceholder('마피아로 의심되는 1명을 선택하세요')
      .addOptions(options);

    const rowSelect = new ActionRowBuilder().addComponents(selectMenu);
    const rowButtons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mafia_finishvote_${session.sessionId}`)
        .setLabel('투표 조기 집계 📊')
        .setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle('🗳️ 마피아 용의자 지목 투표')
      .setColor(0xe67e22)
      .setDescription(
        `생존 주민들은 마피아로 가장 의심되는 사람에게 투표하세요!\n` +
        `최다 득표를 받은 1명은 피고인석에 올라 최후의 변론을 거친 후 처형 투표를 받게 됩니다.`
      );

    await interaction.update({
      embeds: [embed],
      components: [rowSelect, rowButtons],
    });
  },

  // 4. 1차 투표 집계 및 최후의 변론/찬반 재판 단계
  async finishVoting(interaction, session) {
    session.stage = 'TRIAL';

    // 득표수 계산 (정치인은 투표권 2표 행사)
    const voteCounts = new Map();
    for (const [voterId, targetId] of session.votes) {
      const voter = session.players.find((p) => p.id === voterId);
      const weight = voter && voter.role === ROLES.POLITICIAN ? 2 : 1;
      voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + weight);
    }

    let maxVotes = 0;
    let candidates = [];

    for (const [targetId, count] of voteCounts) {
      if (count > maxVotes) {
        maxVotes = count;
        candidates = [targetId];
      } else if (count === maxVotes) {
        candidates.push(targetId);
      }
    }

    // 투표가 없거나 최다 득표자가 동률인 경우 -> 처형 없이 밤으로 전환
    if (candidates.length !== 1 || maxVotes === 0) {
      const embed = new EmbedBuilder()
        .setTitle('⚖️ 투표 결과: 동률 또는 부결')
        .setColor(0x95a5a6)
        .setDescription(
          `동률 득표로 인해 마피아 용의자를 1명으로 좁히지 못했습니다.\n` +
          `처형 없이 조용히 다음 밤으로 넘어갑니다.`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mafia_nextnight_${session.sessionId}`)
          .setLabel('다음 밤으로 🌙')
          .setStyle(ButtonStyle.Secondary)
      );

      if (interaction.replied || interaction.deferred) {
        return interaction.message.edit({ embeds: [embed], components: [row] });
      }
      return interaction.update({ embeds: [embed], components: [row] });
    }

    const suspectId = candidates[0];
    const suspect = session.players.find((p) => p.id === suspectId);
    session.trialTargetId = suspectId;
    session.trialVotes.clear();

    const embed = new EmbedBuilder()
      .setTitle(`⚖️ 피고인석: ${suspect.name} (${maxVotes}표 획득)`)
      .setColor(0xe74c3c)
      .setDescription(
        `주민들의 지목으로 **${suspect.name}** 님이 피고인석에 올랐습니다!\n\n` +
        `🗣️ **최후의 변론**: 피고인은 본인이 시민임을 해명하세요.\n` +
        `나머지 생존 주민들은 해명을 들은 후 아래 버튼으로 **처형 찬반 투표**를 진행하세요!`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mafia_judgement_yes_${session.sessionId}`)
        .setLabel('처형 찬성 ⚔️')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`mafia_judgement_no_${session.sessionId}`)
        .setLabel('처형 반대 🕊️')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`mafia_finishjudge_${session.sessionId}`)
        .setLabel('재판 집계 ⚖️')
        .setStyle(ButtonStyle.Secondary)
    );

    if (interaction.replied || interaction.deferred) {
      return interaction.message.edit({ embeds: [embed], components: [row] });
    }
    return interaction.update({ embeds: [embed], components: [row] });
  },

  // 5. 처형 찬반 투표 집계 (정치인 면책 특권)
  async finishJudgement(interaction, session) {
    const suspect = session.players.find((p) => p.id === session.trialTargetId);

    let yesVotes = 0;
    let noVotes = 0;

    for (const [_, choice] of session.trialVotes) {
      if (choice) yesVotes++;
      else noVotes++;
    }

    const isExecuted = yesVotes > noVotes && yesVotes > 0;

    // 찬성 과반수이지만 피고인이 [정치인]인 경우 -> 처형 무효화 발동!
    if (isExecuted && suspect.role === ROLES.POLITICIAN) {
      const embed = new EmbedBuilder()
        .setTitle('🎩 정치인의 면책 특권 발동! (처형 무효)')
        .setColor(0x8e44ad)
        .setDescription(
          `주민 찬성 **${yesVotes}표** vs 반대 **${noVotes}표**로 **${suspect.name}** 님의 처형이 의결되었으나...\n\n` +
          `⚡ **${suspect.name}** 님은 **[정치인 🎩]**이었습니다!\n` +
          `정치적 면책 특권에 의해 **처형이 즉시 무효화**되고 무죄 방면되었습니다!\n` +
          `*(정치인은 주민 투표로 처형당하지 않습니다)*`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`mafia_nextnight_${session.sessionId}`)
          .setLabel('다음 밤으로 🌙')
          .setStyle(ButtonStyle.Secondary)
      );

      if (interaction.replied || interaction.deferred) {
        return interaction.message.edit({ embeds: [embed], components: [row] });
      }
      return interaction.update({ embeds: [embed], components: [row] });
    }

    let resultText = '';
    if (isExecuted) {
      suspect.isAlive = false;
      // 처형 사망자 처리 (마이크 잠금 + 유령방 초대)
      await handlePlayerDeath(interaction.guild, session, suspect);

      const roleText = session.settings.revealRoleOnDeath
        ? `\n그의 정체는 **${suspect.role.emoji} ${suspect.role.name}** 였습니다!`
        : '';
      resultText = `💀 **처형 집행**: 주민 과반수의 찬성으로 **${suspect.name}** 님이 단두대에서 처형되었습니다.${roleText}`;
    } else {
      resultText = `🕊️ **무죄 방면**: 찬성이 과반을 넘지 못하여 **${suspect.name}** 님은 무죄로 풀려났습니다.`;
    }

    // 승리 조건 검증
    const winResult = this.checkWinCondition(session);
    if (winResult) {
      return this.endGame(interaction, session, winResult);
    }

    const embed = new EmbedBuilder()
      .setTitle('⚖️ 최종 재판 결과')
      .setColor(isExecuted ? 0xe74c3c : 0x2ecc71)
      .setDescription(
        `찬성 **${yesVotes}표** vs 반대 **${noVotes}표**\n\n` +
        `${resultText}\n\n` +
        `아직 마을에 마피아가 남아있습니다. 어둠의 밤을 맞이하세요...`
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mafia_nextnight_${session.sessionId}`)
        .setLabel('다음 밤으로 🌙')
        .setStyle(ButtonStyle.Secondary)
    );

    if (interaction.replied || interaction.deferred) {
      return interaction.message.edit({ embeds: [embed], components: [row] });
    }
    return interaction.update({ embeds: [embed], components: [row] });
  },

  // 승리 조건 체크 (시민 승리 or 마피아 승리)
  checkWinCondition(session) {
    const aliveMafia = session.players.filter((p) => p.isAlive && p.role === ROLES.MAFIA);
    const aliveCitizens = session.players.filter((p) => p.isAlive && p.role !== ROLES.MAFIA);

    if (aliveMafia.length === 0) {
      return { winnerTeam: 'CITIZEN', title: '🎉 시민 진영의 위대한 승리!' };
    }
    if (aliveCitizens.length <= aliveMafia.length) {
      return { winnerTeam: 'MAFIA', title: '🔫 마피아 진영의 완벽한 승리!' };
    }
    return null;
  },

  // 게임 종료 및 전체 직업 공개
  async endGame(interaction, session, winResult) {
    // 음소거 해제 및 임시 음성/사망자 채널 정리
    await cleanupGameChannels(interaction.guild, session);
    mafiaSessions.delete(session.sessionId);

    const fullRolesList = session.players
      .map(
        (p) =>
          `• **${p.name}**: ${p.role.emoji} **${p.role.name}** ${p.isAlive ? '(생존)' : '(사망 💀)'}`
      )
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle(winResult.title)
      .setColor(winResult.winnerTeam === 'CITIZEN' ? 0x2ecc71 : 0xe74c3c)
      .setDescription(
        `마피아 게임이 모두 종료되었습니다!\n\n` +
        `### 🎭 모든 참가자 직업 공개\n${fullRolesList}`
      )
      .setTimestamp();

    const replayRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('mafia_restart')
        .setLabel('마피아 게임 다시 하기 🕵️‍♂️')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('minigame_lobby')
        .setLabel('미니게임 목록 🎮')
        .setStyle(ButtonStyle.Secondary)
    );

    if (interaction.replied || interaction.deferred) {
      return interaction.message.edit({ embeds: [embed], components: [replayRow] });
    }
    return interaction.update({ embeds: [embed], components: [replayRow] });
  },
};
