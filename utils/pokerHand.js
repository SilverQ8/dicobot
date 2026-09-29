// 텍사스 홀덤 포커 족보 계산기 (7장 중 최선의 5장 판정)

const HAND_RANKS = {
  ROYAL_FLUSH: { rank: 10, name: '로열 스트레이트 플러시' },
  STRAIGHT_FLUSH: { rank: 9, name: '스트레이트 플러시' },
  FOUR_OF_A_KIND: { rank: 8, name: '포카드' },
  FULL_HOUSE: { rank: 7, name: '풀하우스' },
  FLUSH: { rank: 6, name: '플러시' },
  STRAIGHT: { rank: 5, name: '스트레이트' },
  THREE_OF_A_KIND: { rank: 4, name: '트리플' },
  TWO_PAIR: { rank: 3, name: '투페어' },
  ONE_PAIR: { rank: 2, name: '원페어' },
  HIGH_CARD: { rank: 1, name: '하이카드' },
};

// 7개 중 5개 조합(Combination) 생성
function getCombinations5(cards) {
  const result = [];
  function combine(start, chosen) {
    if (chosen.length === 5) {
      result.push(chosen);
      return;
    }
    for (let i = start; i < cards.length; i++) {
      combine(i + 1, [...chosen, cards[i]]);
    }
  }
  combine(0, []);
  return result;
}

// 5장의 카드 평가
function evaluate5Cards(cards) {
  // 카드 랭크 기준 내림차순 정렬
  const sorted = [...cards].sort((a, b) => b.pokerRank - a.pokerRank);
  const ranks = sorted.map((c) => c.pokerRank);
  const suits = sorted.map((c) => c.suit);

  // 플러시 확인
  const isFlush = suits.every((s) => s === suits[0]);

  // 스트레이트 확인 (A-5-4-3-2 휠 스트레이트 처리)
  let isStraight = false;
  let straightHigh = 0;

  const isNormalStraight =
    ranks[0] - ranks[1] === 1 &&
    ranks[1] - ranks[2] === 1 &&
    ranks[2] - ranks[3] === 1 &&
    ranks[3] - ranks[4] === 1;

  const isWheelStraight =
    ranks[0] === 14 && ranks[1] === 5 && ranks[2] === 4 && ranks[3] === 3 && ranks[4] === 2;

  if (isNormalStraight) {
    isStraight = true;
    straightHigh = ranks[0];
  } else if (isWheelStraight) {
    isStraight = true;
    straightHigh = 5; // 휠 스트레이트는 5가 하이
  }

  // 스트레이트 플러시 / 로열 스트레이트 플러시
  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return { ...HAND_RANKS.ROYAL_FLUSH, score: [10, straightHigh] };
    }
    return { ...HAND_RANKS.STRAIGHT_FLUSH, score: [9, straightHigh] };
  }

  // 랭크별 등장 횟수 카운트
  const counts = {};
  for (const r of ranks) {
    counts[r] = (counts[r] || 0) + 1;
  }

  // [ [rank, count], ... ] 형태로 정렬 (개수 많은 순, 그 다음 랭크 높은 순)
  const countPairs = Object.entries(counts)
    .map(([r, c]) => [parseInt(r), c])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // 포카드 (4, 1)
  if (countPairs[0][1] === 4) {
    return {
      ...HAND_RANKS.FOUR_OF_A_KIND,
      score: [8, countPairs[0][0], countPairs[1][0]],
    };
  }

  // 풀하우스 (3, 2)
  if (countPairs[0][1] === 3 && countPairs[1][1] === 2) {
    return {
      ...HAND_RANKS.FULL_HOUSE,
      score: [7, countPairs[0][0], countPairs[1][0]],
    };
  }

  // 플러시
  if (isFlush) {
    return {
      ...HAND_RANKS.FLUSH,
      score: [6, ...ranks],
    };
  }

  // 스트레이트
  if (isStraight) {
    return {
      ...HAND_RANKS.STRAIGHT,
      score: [5, straightHigh],
    };
  }

  // 트리플 (3, 1, 1)
  if (countPairs[0][1] === 3) {
    return {
      ...HAND_RANKS.THREE_OF_A_KIND,
      score: [4, countPairs[0][0], countPairs[1][0], countPairs[2][0]],
    };
  }

  // 투페어 (2, 2, 1)
  if (countPairs[0][1] === 2 && countPairs[1][1] === 2) {
    return {
      ...HAND_RANKS.TWO_PAIR,
      score: [3, countPairs[0][0], countPairs[1][0], countPairs[2][0]],
    };
  }

  // 원페어 (2, 1, 1, 1)
  if (countPairs[0][1] === 2) {
    return {
      ...HAND_RANKS.ONE_PAIR,
      score: [2, countPairs[0][0], countPairs[1][0], countPairs[2][0], countPairs[3][0]],
    };
  }

  // 하이카드
  return {
    ...HAND_RANKS.HIGH_CARD,
    score: [1, ...ranks],
  };
}

// 7장의 카드 중 가장 높은 핸드 1개 반환
function evaluate7Cards(cards) {
  const combos = getCombinations5(cards);
  let best = null;

  for (const combo of combos) {
    const evaluated = evaluate5Cards(combo);
    if (!best || compareScores(evaluated.score, best.score) > 0) {
      best = evaluated;
    }
  }

  return best;
}

// 두 점수 비교 (A > B: 1, A < B: -1, A == B: 0)
function compareScores(scoreA, scoreB) {
  for (let i = 0; i < Math.max(scoreA.length, scoreB.length); i++) {
    const valA = scoreA[i] || 0;
    const valB = scoreB[i] || 0;
    if (valA > valB) return 1;
    if (valA < valB) return -1;
  }
  return 0;
}

module.exports = {
  evaluate7Cards,
  compareScores,
};
