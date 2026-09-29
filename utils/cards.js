// 트럼프 카드 및 덱 유틸리티

const SUITS = ['♠️', '♥️', '♦️', '♣️'];
const VALUES = [
  { label: 'A', value: 11, pokerRank: 14 },
  { label: '2', value: 2, pokerRank: 2 },
  { label: '3', value: 3, pokerRank: 3 },
  { label: '4', value: 4, pokerRank: 4 },
  { label: '5', value: 5, pokerRank: 5 },
  { label: '6', value: 6, pokerRank: 6 },
  { label: '7', value: 7, pokerRank: 7 },
  { label: '8', value: 8, pokerRank: 8 },
  { label: '9', value: 9, pokerRank: 9 },
  { label: '10', value: 10, pokerRank: 10 },
  { label: 'J', value: 10, pokerRank: 11 },
  { label: 'Q', value: 10, pokerRank: 12 },
  { label: 'K', value: 10, pokerRank: 13 },
];

// 52장 새 덱 생성
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const val of VALUES) {
      deck.push({
        suit,
        label: val.label,
        value: val.value,
        pokerRank: val.pokerRank,
        toString() {
          return `\`${this.suit} ${this.label}\``;
        },
      });
    }
  }
  return shuffleDeck(deck);
}

// 피셔-예이츠 셔플
function shuffleDeck(deck) {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// 블랙잭 점수 계산 (에이스 11 or 1 유연 처리)
function calculateBlackjackScore(hand) {
  let score = 0;
  let aceCount = 0;

  for (const card of hand) {
    score += card.value;
    if (card.label === 'A') {
      aceCount++;
    }
  }

  // 21을 초과하면 A를 11에서 1로 차감
  while (score > 21 && aceCount > 0) {
    score -= 10;
    aceCount--;
  }

  return score;
}

module.exports = {
  SUITS,
  VALUES,
  createDeck,
  shuffleDeck,
  calculateBlackjackScore,
};
