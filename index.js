require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  Collection,
  ActivityType,
} = require('discord.js');

const teamCommand = require('./commands/team');
const moneyCommand = require('./commands/money');
const attendanceCommand = require('./commands/attendance');
const workCommand = require('./commands/work');
const blackjackCommand = require('./commands/blackjack');
const holdemCommand = require('./commands/holdem');
const mafiaCommand = require('./commands/mafia');
const minigameCommand = require('./commands/minigame');
const gambleCommand = require('./commands/gamble');

// 환경변수 검증
if (!process.env.DISCORD_TOKEN) {
  console.error('❌ .env 파일에 DISCORD_TOKEN이 설정되지 않았습니다.');
  console.error('.env 파일을 열고 발급받은 봇 토큰을 입력해주세요.');
  process.exit(1);
}

// 봇 클라이언트 생성
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// 명령어 컬렉션 등록
client.commands = new Collection();
const commandList = [
  teamCommand,
  moneyCommand,
  attendanceCommand,
  workCommand,
  minigameCommand,
  gambleCommand,
];

for (const cmd of commandList) {
  client.commands.set(cmd.data.name, cmd);
}

// 슬래시 커맨드 등록 함수 (참여 중인 서버 즉시 동기화 + 전역)
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commandsJson = commandList.map((c) => c.data.toJSON());
  const targetId = process.env.CLIENT_ID || client.user.id;

  try {
    console.log('🔄 슬래시 커맨드를 디스코드에 등록하는 중...');

    // 1. 참여 중인 서버들에 즉시 등록 (지연 시간 0초!)
    for (const [guildId, guild] of client.guilds.cache) {
      try {
        await rest.put(Routes.applicationGuildCommands(targetId, guildId), {
          body: commandsJson,
        });
        console.log(`✅ [${guild.name}] 서버에 명령어 즉시 등록 완료!`);
      } catch (err) {
        console.error(`서버(${guild.name}) 커맨드 등록 실패:`, err.message);
      }
    }

    // 2. 전역(Global) 등록
    await rest.put(Routes.applicationCommands(targetId), {
      body: commandsJson,
    });
    console.log('✅ 전역 슬래시 커맨드 등록 완료!');
  } catch (error) {
    console.error('❌ 슬래시 커맨드 등록 중 오류 발생:', error);
  }
}

// 봇 준비 완료 이벤트
client.once('ready', async () => {
  console.log(`🤖 로그인 성공: ${client.user.tag}`);

  // 상태 메시지 설정
  client.user.setActivity('/미니게임', {
    type: ActivityType.Playing,
  });

  // 슬래시 커맨드 자동 등록
  await registerCommands();
  console.log('🎉 봇이 모든 준비를 마쳤습니다!');
});

// 인터랙션 (슬래시 커맨드 및 버튼, 모달, 셀렉트메뉴) 처리
client.on('interactionCreate', async (interaction) => {
  try {
    // 1. 슬래시 커맨드 처리
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;

      await command.execute(interaction);
    }

    // 2. 버튼 클릭 처리
    if (interaction.isButton()) {
      const customId = interaction.customId;

      // 팀 나누기 관련 버튼
      if (
        customId.startsWith('reroll_') ||
        customId.startsWith('move_') ||
        customId.startsWith('gather_')
      ) {
        await teamCommand.handleButton(interaction);
      }
      // 노가다(채굴) 관련 버튼
      else if (customId.startsWith('work_')) {
        await workCommand.handleButton(interaction);
      }
      // 블랙잭 관련 버튼
      else if (customId.startsWith('bj_')) {
        await blackjackCommand.handleButton(interaction);
      }
      // 텍사스 홀덤 관련 버튼
      else if (customId.startsWith('holdem_')) {
        await holdemCommand.handleButton(interaction);
      }
      // 마피아 게임 관련 버튼
      else if (customId.startsWith('mafia_')) {
        await mafiaCommand.handleButton(interaction);
      }
    }

    // 3. 모달(팝업) 제출 처리
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('holdem_modal_')) {
        await holdemCommand.handleModal(interaction);
      } else if (interaction.customId.startsWith('gamble_modal_')) {
        await gambleCommand.handleModal(interaction);
      }
    }

    // 4. 셀렉트 메뉴 선택 처리
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith('minigame_select_')) {
        await minigameCommand.handleSelectMenu(interaction);
      } else if (interaction.customId.startsWith('gamble_select_')) {
        await gambleCommand.handleSelectMenu(interaction);
      } else if (interaction.customId.startsWith('mafia_')) {
        await mafiaCommand.handleSelectMenu(interaction);
      }
    }
  } catch (error) {
    console.error('인터랙션 처리 중 오류 발생:', error);
    try {
      const replyMessage = {
        content: '⚠️ 명령어 실행 중 오류가 발생했습니다.',
        ephemeral: true,
      };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(replyMessage);
      } else {
        await interaction.reply(replyMessage);
      }
    } catch (e) {
      // 이미 만료된 인터랙션 무시
    }
  }
});

// 프로세스 예외 핸들러 (봇 강제 종료 방지)
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

// 봇 로그인
client.login(process.env.DISCORD_TOKEN);
