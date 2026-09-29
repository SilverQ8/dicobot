const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} = require('discord.js');

// Fisher-Yates 셔플 알고리즘
function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 팀 분배 로직 및 임베드 생성 함수
function createTeamEmbed(teams, totalMemberCount) {
  const teamEmojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '🟤', '⚪'];

  const embed = new EmbedBuilder()
    .setTitle('🎲 팀 나누기 결과')
    .setColor(0x5865f2)
    .setDescription(`총 **${totalMemberCount}명**의 참가자를 **${teams.length}개 팀**으로 나누었습니다!`)
    .setTimestamp();

  teams.forEach((team, idx) => {
    const emoji = teamEmojis[idx % teamEmojis.length];
    const memberList =
      team.length > 0
        ? team.map((m, i) => `${i + 1}. ${m.name}`).join('\n')
        : '*참가자 없음*';

    embed.addFields({
      name: `${emoji} 팀 ${idx + 1} (${team.length}명)`,
      value: memberList,
      inline: true,
    });
  });

  return embed;
}

// 버튼 컴포넌트 생성 (state: 'initial' | 'moved')
function createButtons(sessionId, isVoiceMode, state = 'initial') {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`reroll_${sessionId}`)
      .setLabel('다시 섞기 🔄')
      .setStyle(ButtonStyle.Primary)
  );

  if (isVoiceMode) {
    if (state === 'initial') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`move_${sessionId}`)
          .setLabel('음성 채널 분리 🚀')
          .setStyle(ButtonStyle.Success)
      );
    } else if (state === 'moved') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`gather_${sessionId}`)
          .setLabel('원래 방으로 모이기 📢')
          .setStyle(ButtonStyle.Danger)
      );
    }
  }

  return row;
}

// 세션 상태 저장소 (메모리)
const sessionCache = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('팀나누기')
    .setDescription('참가자들을 무작위로 여러 팀으로 나눕니다.')
    .addIntegerOption((option) =>
      option
        .setName('팀수')
        .setDescription('나눌 팀의 개수를 입력하세요 (기본값: 2)')
        .setMinValue(2)
        .setMaxValue(8)
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName('멤버')
        .setDescription('참가자 이름들을 쉼표(,)나 띄어쓰기로 구분해 입력하세요 (미입력 시 음성채널 멤버 자동 참가)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const teamCount = interaction.options.getInteger('팀수') || 2;
    const memberInput = interaction.options.getString('멤버');

    let members = [];
    let isVoiceMode = false;
    let originChannelId = null;

    if (memberInput) {
      // 1. 직접 텍스트로 입력한 경우
      const names = memberInput
        .split(/[, \n]+/)
        .map((m) => m.trim())
        .filter((m) => m.length > 0);

      members = names.map((name) => ({ id: null, name }));
    } else {
      // 2. 음성 채널 자동 감지 모드
      const voiceChannel = interaction.member?.voice?.channel;
      if (!voiceChannel) {
        return interaction.reply({
          content: '❌ **멤버를 직접 입력**하거나, **음성 채널에 입장한 상태**에서 명령어를 사용해주세요!\n예시: `/팀나누기 팀수:2 멤버:철수, 영희, 민수, 훈이`',
          ephemeral: true,
        });
      }

      isVoiceMode = true;
      originChannelId = voiceChannel.id;

      // 봇 제외한 음성 채널 멤버 수집
      members = voiceChannel.members
        .filter((m) => !m.user.bot)
        .map((m) => ({ id: m.id, name: m.displayName }));
    }

    if (members.length < teamCount) {
      return interaction.reply({
        content: `❌ 참가자 수(${members.length}명)가 팀 수(${teamCount}팀)보다 적습니다!`,
        ephemeral: true,
      });
    }

    // 팀 분배
    const shuffled = shuffleArray(members);
    const teams = Array.from({ length: teamCount }, () => []);
    shuffled.forEach((m, idx) => {
      teams[idx % teamCount].push(m);
    });

    const sessionId = interaction.id;
    const embed = createTeamEmbed(teams, members.length);
    const row = createButtons(sessionId, isVoiceMode, 'initial');

    // 세션 정보 캐싱 (1시간 유효)
    sessionCache.set(sessionId, {
      members,
      teamCount,
      teams,
      isVoiceMode,
      originChannelId,
      createdChannelIds: [],
    });
    setTimeout(() => sessionCache.delete(sessionId), 1000 * 60 * 60);

    await interaction.reply({ embeds: [embed], components: [row] });
  },

  // 버튼 인터랙션 핸들러
  async handleButton(interaction) {
    const [action, sessionId] = interaction.customId.split('_');
    const session = sessionCache.get(sessionId);

    if (!session) {
      return interaction.reply({
        content: '⚠️ 세션 유효 시간이 만료되었습니다. 명령어를 다시 실행해주세요.',
        ephemeral: true,
      });
    }

    const teamEmojis = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠', '🟤', '⚪'];

    // 1. 다시 섞기
    if (action === 'reroll') {
      const shuffled = shuffleArray(session.members);
      const newTeams = Array.from({ length: session.teamCount }, () => []);
      shuffled.forEach((m, idx) => {
        newTeams[idx % session.teamCount].push(m);
      });

      session.teams = newTeams;
      const embed = createTeamEmbed(newTeams, session.members.length);
      const row = createButtons(
        sessionId,
        session.isVoiceMode,
        session.createdChannelIds.length > 0 ? 'moved' : 'initial'
      );

      return interaction.update({ embeds: [embed], components: [row] });
    }

    // 2. 음성 채널 분리 및 이동
    if (action === 'move') {
      // 봇 권한 체크 (채널 관리 및 멤버 이동)
      const botMember = interaction.guild.members.me;
      if (
        !botMember.permissions.has([
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
        ])
      ) {
        return interaction.reply({
          content: '❌ 봇에게 **[채널 관리]** 및 **[멤버 이동]** 권한이 필요합니다! 서버 관리자에게 권한을 요청해주세요.',
          ephemeral: true,
        });
      }

      await interaction.deferUpdate();

      try {
        const originChannel = interaction.guild.channels.cache.get(session.originChannelId);
        const parentId = originChannel ? originChannel.parentId : null;

        const createdChannelIds = [];

        // 팀별 음성 채널 생성 및 이동
        for (let i = 0; i < session.teams.length; i++) {
          const emoji = teamEmojis[i % teamEmojis.length];
          const channelName = `${emoji} ${i + 1}팀`;

          // 임시 음성 채널 생성
          const tempChannel = await interaction.guild.channels.create({
            name: channelName,
            type: ChannelType.GuildVoice,
            parent: parentId,
            reason: `[DicoBot] 팀 나누기 음성 채널 분리`,
          });

          createdChannelIds.push(tempChannel.id);

          // 팀원들 해당 채널로 이동
          const team = session.teams[i];
          for (const memberInfo of team) {
            try {
              const guildMember = await interaction.guild.members.fetch(memberInfo.id);
              if (guildMember?.voice?.channel) {
                await guildMember.voice.setChannel(tempChannel);
              }
            } catch (err) {
              console.error(`멤버 ${memberInfo.name} 이동 실패:`, err.message);
            }
          }
        }

        session.createdChannelIds = createdChannelIds;

        const row = createButtons(sessionId, session.isVoiceMode, 'moved');
        const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
        originalEmbed.setFooter({ text: '🚀 모든 팀이 각 음성 채널로 이동되었습니다!' });

        await interaction.editReply({
          embeds: [originalEmbed],
          components: [row],
        });
      } catch (err) {
        console.error('음성 채널 분리 오류:', err);
        await interaction.followUp({
          content: `⚠️ 음성 채널 생성/이동 중 오류가 발생했습니다: ${err.message}`,
          ephemeral: true,
        });
      }
    }

    // 3. 원래 통화방으로 모이기 & 임시 채널 삭제
    if (action === 'gather') {
      await interaction.deferUpdate();

      try {
        const originChannel = interaction.guild.channels.cache.get(session.originChannelId);

        // 생성했던 임시 채널에 있는 유저들을 원래 방으로 복귀
        for (const channelId of session.createdChannelIds) {
          const tempChannel = interaction.guild.channels.cache.get(channelId);
          if (tempChannel) {
            for (const [_, member] of tempChannel.members) {
              try {
                if (originChannel) {
                  await member.voice.setChannel(originChannel);
                }
              } catch (err) {
                console.error(`멤버 복귀 실패:`, err.message);
              }
            }

            // 임시 채널 삭제
            try {
              await tempChannel.delete('팀 나누기 종료로 인한 임시 채널 삭제');
            } catch (err) {
              console.error(`임시 채널 삭제 실패:`, err.message);
            }
          }
        }

        session.createdChannelIds = [];

        const row = createButtons(sessionId, session.isVoiceMode, 'initial');
        const originalEmbed = EmbedBuilder.from(interaction.message.embeds[0]);
        originalEmbed.setFooter({ text: '📢 모든 인원이 원래 음성 채널로 복귀했습니다.' });

        await interaction.editReply({
          embeds: [originalEmbed],
          components: [row],
        });
      } catch (err) {
        console.error('인원 복귀 오류:', err);
        await interaction.followUp({
          content: `⚠️ 인원 복귀 중 오류가 발생했습니다: ${err.message}`,
          ephemeral: true,
        });
      }
    }
  },
};
