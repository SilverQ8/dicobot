const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'coins.json');

// data 디렉토리 확인 및 생성
const dataDir = path.dirname(DATA_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 코인 데이터 로드
function loadData() {
  try {
    if (fs.existsSync(DATA_PATH)) {
      const data = fs.readFileSync(DATA_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('코인 데이터 로드 실패:', err);
  }
  return {};
}

// 코인 데이터 저장
function saveData(data) {
  try {
    fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('코인 데이터 저장 실패:', err);
  }
}

// 한국 시간(KST) 기준 YYYY-MM-DD 날짜 문자열 반환
function getKSTDateString(date = new Date()) {
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DEFAULT_COINS = 10000; // 신규 유저 기본 지급 10,000코인
const ATTENDANCE_COINS = 5000; // 일일 출석 5,000코인

module.exports = {
  // 잔액 조회 (처음이면 기본금 지급)
  getBalance(userId) {
    const data = loadData();
    if (!data[userId]) {
      data[userId] = { coins: DEFAULT_COINS, lastAttendanceDate: '' };
      saveData(data);
    }
    return data[userId].coins;
  },

  // 코인 추가/차감
  modifyCoins(userId, amount) {
    const data = loadData();
    if (!data[userId]) {
      data[userId] = { coins: DEFAULT_COINS, lastAttendanceDate: '' };
    }
    data[userId].coins = Math.max(0, data[userId].coins + amount);
    saveData(data);
    return data[userId].coins;
  },

  // 자정 기준 출석체크
  claimAttendance(userId) {
    const data = loadData();
    if (!data[userId]) {
      data[userId] = { coins: DEFAULT_COINS, lastAttendanceDate: '' };
    }

    const todayKST = getKSTDateString();
    const lastDate = data[userId].lastAttendanceDate || '';

    if (lastDate === todayKST) {
      return { success: false };
    }

    data[userId].coins += ATTENDANCE_COINS;
    data[userId].lastAttendanceDate = todayKST;
    saveData(data);

    return {
      success: true,
      newBalance: data[userId].coins,
      amount: ATTENDANCE_COINS,
    };
  },
};
