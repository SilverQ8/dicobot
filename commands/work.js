const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const economy = require('../utils/economy');

// 노가다 통계 캐시 (세션별 총 클릭 수 등)
const workStats = new Map();

function createWorkEmbed(user, reward = 0, isJackpot = false, totalEarned = 0) {
  const balance = economy.getBalance(user.id);

  const embed = new EmbedBuilder()
    .setTitle('⛏️ 광산 노가다 (클릭 채굴)')
    .setColor(isJackpot ? 0xf1c40f : 0x7f8c8d)
    .setDescription(
      `버튼을 연타하여 코인을 채굴하세요!\n` +
      `기본 보상: **10 코인** | 🍀 대박 확률(5%): **100 코인**`
    )
    .addFields(
      {
        name: '👤 광부',
        value: `**${user.displayName}**`,
        inline: true,
      },
      {
        name: '🪙 현재 보유 코인',
        value: `**${balance.toLocaleString()} 코인**`,
        inline: true,
      }
    )
    .setTimestamp();

  if (reward > 0) {
    if (isJackpot) {
      embed.addFields({
        name: '✨ 채굴 결과',
        value: `🎉 **대박 터졌다!! 황금 광맥 발견!! (+100 코인)**`,
        inline: false,
      });
    } else {
      embed.addFields({
        name: '⛏️ 채굴 결과',
        value: `조약돌을 캤습니다. **(+10 코인)**`,
        inline: false,
      });
    }
  }

  return embed;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('노가다')
    .setDescription('버튼을 클릭하여 10코인(5% 확률로 100코인)을 채굴합니다!'),

  async execute(interaction) {
    const userId = interaction.user.id;
    const embed = createWorkEmbed(interaction.user);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`work_mine_${userId}`)
        .setLabel('곡괭이질 하기! ⛏️')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({ embeds: [embed], components: [row] });
  },

  // 버튼 인터랙션 처리
  async handleButton(interaction) {
    const [_, action, ownerId] = interaction.customId.split('_');
    const clickerId = interaction.user.id;

    // 본인의 노가다 창만 조작할 수 있도록 제한 (원하는 경우 공용으로도 가능하나 개인별 방이 안전)
    if (ownerId && ownerId !== clickerId) {
      return interaction.reply({
        content: '❌ 본인이 `/노가다` 명령어를 입력하여 생성한 채굴 창에서 작업해주세요!',
        ephemeral: true,
      });
    }

    // 5% 확률로 100 코인 대박, 95% 확률로 10 코인
    const isJackpot = Math.random() < 0.05;
    const reward = isJackpot ? 100 : 10;

    economy.modifyCoins(clickerId, reward);

    const embed = createWorkEmbed(interaction.user, reward, isJackpot);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(interaction.customId)
        .setLabel(isJackpot ? '대박!! 계속 곡괭이질 ⛏️' : '곡괭이질 하기! ⛏️')
        .setStyle(isJackpot ? ButtonStyle.Danger : ButtonStyle.Success)
    );

    try {
      await interaction.update({ embeds: [embed], components: [row] });
    } catch (err) {
      // 너무 빠른 광클로 인한 discord API update 충돌 시 안전하게 무시
      if (err.code !== 10062 && err.code !== 40060) {
        console.error('노가다 버튼 응답 오류:', err);
      }
    }
  },
};
