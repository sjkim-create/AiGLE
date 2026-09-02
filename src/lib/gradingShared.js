/**
 * gradingShared.js
 * 자동/자율 채점 기준 공유 모델 — TSK-13(직접 입력 2)·TSK-12(파일 업로드)에서 공통 사용.
 * 화면 렌더는 각 화면이 담당하고, 본 모듈은 상수·순수 헬퍼만 제공한다.
 */

// 평가 단계(등급 체계)별 루브릭 레벨 — DSH-02 등급명·색상과 정합
export const LEVEL_META = {
  '매우 우수': { color: '#10B981', bg: '#D1FAE5', desc: '성취기준을 탁월하게 달성하며, 논리·근거·표현이 모두 빼어나다.' },
  '우수':     { color: '#2A75F3', bg: '#EFF6FF', desc: '성취기준을 충실히 달성하며, 논리적 일관성과 근거가 분명하다.' },
  '보통':     { color: '#94A3B8', bg: '#F1F5F9', desc: '성취기준의 주요 요소를 충족하나, 일부 논리 비약 또는 근거 부족이 관찰된다.' },
  '노력':     { color: '#F59E0B', bg: '#FEF3C7', desc: '성취기준 일부만 충족하며, 핵심 개념의 이해 또는 표현에 어려움이 있다.' },
  '매우 노력': { color: '#EF4444', bg: '#FEE2E2', desc: '문항 요구와 답안 내용이 부합하지 않거나 이해가 매우 미흡하다.' },
};

// 자동평가 채점 단계 — DB 평가지표 템플릿은 3단계/5단계로 제공 (2022 개정 교육과정 내용체계 기반)
export const AUTO_SCALES = [3, 5];
export const AUTO_LEVELS = {
  3: [{ name: '우수', letter: 'A' }, { name: '보통', letter: 'B' }, { name: '노력', letter: 'C' }],
  5: [{ name: '매우 우수', letter: 'A' }, { name: '우수', letter: 'B' }, { name: '보통', letter: 'C' }, { name: '노력', letter: 'D' }, { name: '매우 노력', letter: 'E' }],
};
// 채점 기준표 행(범주) — 2022 개정 교육과정 내용체계 4범주
export const RUBRIC_CATEGORIES = [
  { key: 'A', name: '지식 이해 및 통합 적용' },
  { key: 'B', name: '과정·기능 및 탐구 수행' },
  { key: 'C', name: '논리적 구성 및 표현력' },
  { key: 'D', name: '가치·태도 및 성찰' },
];
// 범주 × 단계별 템플릿 서술 — [categoryKey][scale] = [등급 순서대로]
export const RUBRIC_TEMPLATE = {
  A: {
    3: ['대화의 원리와 공동체의 담화 관습을 정확히 이해하여 실제 소통 상황에 능숙하게 적용함.', '대화의 원리를 대체로 이해하고 있으나 실제 상황 적용이 다소 전형적임.', '대화의 원리나 담화 관습에 대한 기초적인 이해가 부족함.'],
    5: ['대화의 원리와 공동체의 담화 관습을 깊이 있게 이해하여 다양한 소통 상황에 창의적으로 적용함.', '대화의 원리와 담화 관습을 정확히 이해하여 실제 소통 상황에 능숙하게 적용함.', '대화의 원리를 대체로 이해하고 있으나 실제 상황 적용이 다소 전형적임.', '대화의 원리나 담화 관습에 대한 이해가 부분적임.', '대화의 원리나 담화 관습에 대한 기초적인 이해가 부족함.'],
  },
  B: {
    3: ['자신의 소통 과정을 정교하게 점검하며 상황에 맞는 유연한 소통 전략을 수행함.', '소통 과정에 대한 기본적인 점검을 수행하나 전략 활용이 단편적임.', '자신의 듣기·말하기 과정을 점검하거나 조정하는 기능이 미흡함.'],
    5: ['자신의 소통 과정을 비판적으로 점검하고 다양한 전략을 통합적으로 운용함.', '자신의 소통 과정을 정교하게 점검하며 상황에 맞는 유연한 소통 전략을 수행함.', '소통 과정에 대한 기본적인 점검을 수행하나 전략 활용이 단편적임.', '소통 과정 점검이 단순하며 전략 수행에 어려움이 있음.', '자신의 듣기·말하기 과정을 점검하거나 조정하는 기능이 미흡함.'],
  },
  C: {
    3: ['상대의 의도를 고려하여 자신의 생각을 논리적이고 정중하게 조직하여 표현함.', '자신의 생각을 전달 가능한 수준으로 조직하나 표현의 정교함이 부족함.', '표현이 모호하며 대화의 논리적 연결이 부자연스러움.'],
    5: ['상대와 맥락을 깊이 고려하여 생각을 설득력 있고 정교하게 조직·표현함.', '상대의 의도를 고려하여 자신의 생각을 논리적이고 정중하게 조직하여 표현함.', '자신의 생각을 전달 가능한 수준으로 조직하나 표현의 정교함이 부족함.', '생각의 조직이 느슨하며 표현이 다소 모호함.', '표현이 모호하며 대화의 논리적 연결이 부자연스러움.'],
  },
  D: {
    3: ['상대를 존중하고 공감하는 태도가 탁월하며 자신의 언어 습관을 깊이 있게 성찰함.', '소통 예절을 준수하며 일반적인 수준의 자기 성찰을 수행함.', '소통 태도가 소극적이며 공동체의 담화 예절 준수가 미흡함.'],
    5: ['상대를 깊이 존중·공감하며 자신의 언어 습관을 지속적으로 성찰·개선함.', '상대를 존중하고 공감하는 태도가 탁월하며 자신의 언어 습관을 깊이 있게 성찰함.', '소통 예절을 준수하며 일반적인 수준의 자기 성찰을 수행함.', '소통 예절 준수가 부분적이며 자기 성찰이 피상적임.', '소통 태도가 소극적이며 공동체의 담화 예절 준수가 미흡함.'],
  },
};

// 교과 → 과목(세부 과목) 옵션 (2022 개정 교육과정 예시)
export const SUBJECTS = {
  '국어': ['공통국어1', '공통국어2', '화법과 언어', '독서와 작문', '문학'],
  '수학': ['공통수학1', '공통수학2', '대수', '미적분Ⅰ', '확률과 통계'],
  '영어': ['공통영어1', '공통영어2', '영어Ⅰ', '영어Ⅱ', '영어 독해와 작문'],
  '사회': ['통합사회1', '통합사회2', '한국사1', '한국사2', '세계시민과 지리'],
  '과학': ['통합과학1', '통합과학2', '물리학', '화학', '생명과학'],
  '도덕': ['현대사회와 윤리', '윤리와 사상', '인문학과 윤리'],
};
export const subjectsOf = (subject) => SUBJECTS[subject] || [];

// 교과별 핵심역량·핵심평가영역 프레임워크 (2022 개정 교육과정 예시)
// — 교과 선택에 따라 핵심역량 chips·핵심평가영역 chips가 동적으로 노출된다.
export const SUBJECT_FRAMEWORK = {
  '국어': {
    competencies: ['비판적·창의적 사고 역량', '자기 성찰·계발 역량', '의사소통 역량', '공동체·대인관계 역량', '정보 처리 역량', '문화 향유 역량'],
    areas: ['듣기·말하기', '읽기', '쓰기', '문법', '문학', '매체'],
  },
  '수학': {
    competencies: ['문제 해결', '추론', '의사소통', '연결', '정보 처리', '태도 및 실천'],
    areas: ['수와 연산', '변화와 관계', '도형과 측정', '자료와 가능성'],
  },
  '영어': {
    competencies: ['영어 의사소통 역량', '자기관리 역량', '공동체 역량', '지식정보처리 역량'],
    areas: ['듣기', '말하기', '읽기', '쓰기'],
  },
  '사회': {
    competencies: ['창의적 사고력', '비판적 사고력', '문제 해결력 및 의사 결정력', '의사소통 및 협업 능력', '정보 활용 능력'],
    areas: ['지리 인식', '일반 사회', '역사 인식', '윤리적 탐구'],
  },
  '과학': {
    competencies: ['과학적 사고력', '과학적 탐구 능력', '과학적 문제 해결력', '과학적 의사소통 능력', '과학적 참여와 평생학습 능력'],
    areas: ['운동과 에너지', '물질', '생명', '지구와 우주'],
  },
  '도덕': {
    competencies: ['자기 존중 및 관리 능력', '도덕적 사고 능력', '도덕적 대인관계 능력', '도덕적 정서 능력', '도덕적 공동체 의식'],
    areas: ['자신과의 관계', '타인과의 관계', '사회·공동체와의 관계', '자연·초월과의 관계'],
  },
};
export const competenciesOf = (subject) => (SUBJECT_FRAMEWORK[subject]?.competencies) || [];
export const evalAreasOf = (subject) => (SUBJECT_FRAMEWORK[subject]?.areas) || [];

// 학교급별 학년 편제(학년군)
export const GRADE_BANDS = {
  '초등학교': ['1~2학년', '3~4학년', '5~6학년'],
  '중학교': ['1~3학년'],
  '고등학교': ['1~3학년', '2~3학년'],
};
export const gradesOf = (schoolLevel) => GRADE_BANDS[schoolLevel] || ['1~3학년'];

// 성취기준 텍스트에서 코드([10국어1-01-01]) 추출
export const stdCode = (text) => {
  const m = (text || '').match(/\[([^\]]+)\]/);
  return m ? m[1] : '성취기준';
};

// 등급 이름 (3/4/5 단계 체계) — v3.53 4단계 갱신 (매우 우수 복귀)
export const GRADE_NAMES = {
  3: ['우수', '보통', '노력'],
  4: ['매우 우수', '우수', '보통', '노력'],
  5: ['매우 우수', '우수', '보통', '노력', '매우 노력'],
};

// [v3.53] % 기반 cutoff 정책 (학교 평가 관례)
//   3등급: 우수 ≥80%·보통 ≥60%·노력 ≥0%
//   4등급: 매우 우수 ≥90%·우수 ≥80%·보통 ≥60%·노력 ≥0% (v3.53 — 「매우 우수」 복귀, 「매우 노력」 폐기)
//   5등급: 매우 우수 ≥90%·우수 ≥80%·보통 ≥70%·노력 ≥60%·매우 노력 ≥0%
export const GRADE_CUTOFFS = {
  3: [{ min: 80, name: '우수' }, { min: 60, name: '보통' }, { min: 0, name: '노력' }],
  4: [{ min: 90, name: '매우 우수' }, { min: 80, name: '우수' }, { min: 60, name: '보통' }, { min: 0, name: '노력' }],
  5: [{ min: 90, name: '매우 우수' }, { min: 80, name: '우수' }, { min: 70, name: '보통' }, { min: 60, name: '노력' }, { min: 0, name: '매우 노력' }],
};

// ── 자율평가 점수 모델: 배점(M)·단계(n)·간격(d) ──────────────────────────
// 점수 행 = 배점에서 간격만큼 차감: [M, M-d, M-2d, …] (최저 등급 0점 이상)
export const clampLevels = (maxPoints) => {
  const M = Number(maxPoints) || 0;
  if (M < 2) return 2;
  return Math.max(2, M + 1); // 간격 1이면 배점부터 0점까지 모든 정수가 단계 → 최대 = 배점+1
};
export const maxIntervalFor = (maxPoints, levels) => {
  const M = Number(maxPoints) || 0;
  const n = Math.max(2, Number(levels) || 2);
  if (M < 2) return 1;
  return Math.max(1, Math.floor(M / (n - 1))); // 최대 간격이면 최저 등급 = 0점
};
export const defaultInterval = (maxPoints, levels) => maxIntervalFor(maxPoints, levels);
export const buildScoreRows = (maxPoints, levels, interval, prevRows = []) => {
  const M = Number(maxPoints) || 0;
  // [v3.73] 단계 수(n)는 사용자가 스텝퍼로 정한 값을 그대로 쓴다 — 배점(M)으로 clamp 하지 않는다.
  // 舊 로직은 배점을 직접 타이핑하는 도중의 빈 값·1점 같은 중간 상태에서 n을 2로 강등시켜,
  // 늘려둔 입력 구간과 거기 적어둔 평가 내용을 되돌릴 수 없게 지웠다.
  // (스피너 화살표 조작은 값이 2 미만으로 내려가는 중간 상태가 없어 이 문제가 드러나지 않았다)
  const n = Math.max(2, Number(levels) || 2);
  const d = Math.max(1, Math.min(maxIntervalFor(M, n), Number(interval) || 1));
  return Array.from({ length: n }, (_, i) => ({
    score: Math.max(0, M - i * d),
    desc: prevRows[i]?.desc || '',
  }));
};
export const rowsDescending = (rows) => rows.every((r, i) => i === 0 || (Number(rows[i - 1].score) || 0) > (Number(r.score) || 0));

let _uid = 1;
export const uid = (p) => `${p}-${_uid++}`;
export const makeCriterion = () => {
  // [v3.73] 기본 점수 입력 구간 = 3단계 유지. 배점 입력 시 2단계로 줄어들던 현상은 buildScoreRows의 단계 clamp 제거로 해소했다
  const maxPoints = 6, levels = 3, interval = defaultInterval(maxPoints, levels); // 6·3단계 → 간격3 → [6,3,0]
  return { id: uid('c'), name: '', maxPoints, levels, interval, rows: buildScoreRows(maxPoints, levels, interval) };
};

// [v3.51] 점수 → 등급 환산 — % 기반 cutoff 복귀 (학교 평가 관례 정합)
export const scoreToGrade = (score, max, scale) => {
  if (!max || max <= 0) return '-';
  const pct = (Number(score) / max) * 100;
  const band = GRADE_CUTOFFS[scale].find((b) => pct >= b.min);
  return band ? band.name : '-';
};
