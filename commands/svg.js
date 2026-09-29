const { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const sharp = require('sharp');

/**
 * SVG 버퍼나 문자열을 PNG 버퍼로 변환
 * @param {Buffer|string} input SVG 입력
 * @param {number} scale 배율 (기본 1)
 */
async function convertSvgToPng(input, scale = 1) {
  const density = Math.round(72 * (scale || 1));
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf-8');

  // sharp로 SVG -> PNG 변환
  return await sharp(buf, { density: Math.max(72, density) })
    .png()
    .toBuffer();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('svg')
    .setDescription('SVG 파일 또는 코드를 PNG 이미지로 변환하여 렌더링합니다.')
    .addAttachmentOption((opt) =>
      opt
        .setName('파일')
        .setDescription('변환할 .svg 파일을 첨부해주세요.')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('코드')
        .setDescription('변환할 SVG 코드(<svg>...</svg>)를 직접 입력하세요.')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('화질')
        .setDescription('이미지 화질 배율을 선택합니다. (기본값: 2배 고화질)')
        .setRequired(false)
        .addChoices(
          { name: '1배 (기본)', value: 1 },
          { name: '2배 (선명함/추천)', value: 2 },
          { name: '3배 (초고화질)', value: 3 }
        )
    ),

  async execute(interaction) {
    const file = interaction.options.getAttachment('파일');
    const code = interaction.options.getString('코드');
    const scale = interaction.options.getInteger('화질') || 2;

    if (!file && !code) {
      return interaction.reply({
        content: '❌ **.svg 파일**을 첨부하거나 **SVG 코드**를 입력해주세요!',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      let svgBuffer;
      let filename = 'rendered.png';

      if (file) {
        if (!file.name.toLowerCase().endsWith('.svg')) {
          return interaction.editReply('❌ 확장자가 `.svg`인 파일만 지원합니다.');
        }
        filename = `${file.name.replace(/\.svg$/i, '')}.png`;

        const res = await fetch(file.url);
        if (!res.ok) throw new Error(`파일 다운로드 실패 (${res.status})`);
        const arrayBuf = await res.arrayBuffer();
        svgBuffer = Buffer.from(arrayBuf);
      } else {
        svgBuffer = Buffer.from(code.trim(), 'utf-8');
      }

      // 변환 수행
      const pngBuffer = await convertSvgToPng(svgBuffer, scale);
      const attachment = new AttachmentBuilder(pngBuffer, { name: filename });

      const metadata = await sharp(pngBuffer).metadata();

      const embed = new EmbedBuilder()
        .setTitle('🖼️ SVG 렌더링 완료')
        .setColor(0x5865f2)
        .setDescription(
          `**파일명**: \`${filename}\`\n` +
          `**해상도**: ${metadata.width} × ${metadata.height} px (${scale}x 배율)\n` +
          `**용량**: ${(pngBuffer.length / 1024).toFixed(1)} KB`
        )
        .setImage(`attachment://${filename}`)
        .setFooter({ text: '디스코드에서 SVG 이미지를 바로 확인할 수 있습니다.' })
        .setTimestamp();

      await interaction.editReply({
        embeds: [embed],
        files: [attachment],
      });
    } catch (err) {
      console.error('SVG 변환 오류:', err);
      await interaction.editReply({
        content: `❌ SVG 렌더링 중 오류가 발생했습니다.\n\`\`\`${err.message}\`\`\``,
      });
    }
  },

  convertSvgToPng,
};
