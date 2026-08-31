/**
 * GradingManagement.jsx
 * 과제 및 채점관리 화면입니다.
 * 과제 선택, 학생별 채점 상태 관리(미채점 / 채점 확인 / 결과 발송),
 * 일괄 채점 워크플로우(NeoStudio2Lite 연동), 채점 상세 모달 기능을 포함합니다.
 * Setting.jsx에서 activeMenu === '과제 및 채점관리'일 때 렌더링됩니다.
 *
 * [SCR-06] variant='v2' — 「채점 관리 2」(퇴고 지원판)
 *   기존 v1 기능을 그대로 포함하고, 학생 답안을 「차수(round)」 축으로 관리하는 퇴고 기능을 추가한다.
 *   - 1차 채점 완료·결과 발송 후 [✍ 퇴고 요청] → 2차 답안지 재배부(새 번호표) → 학생 재작성 → 2차 채점
 *   - 1차 펜 데이터는 삭제하지 않고 차수 이력(history)으로 보존 → 1차↔2차 등급 추이 비교
 *   - AI 채점 횟수 카운터는 차수별 독립 (1차 최대 2회 / 2차 최대 2회)
 *   v2 전용 UI는 전부 `isV2` 게이트 안에 있으므로 v1(기존 채점 관리) 동작은 변하지 않는다.
 */
import React, { useState, useEffect } from 'react';
import UngradedDetailModal from './UngradedDetailModal';
import GradingReviewModal from './GradingReviewModal';
import ScanGradingModal from './ScanGradingModal';

// ─────────────────────────────────────────────
// [SCR-06] 퇴고 — 등급 ↔ 점수 환산 및 추이 판정
//   프로토타입에서는 3단 등급(우수/보통/노력)만 사용하므로 정수 점수로 환산해 증감을 판정한다.
//   실서버 연동 시에는 문항별 배점 합계(0~100)로 교체 예정.
// ─────────────────────────────────────────────
const GRADE_SCORE = { 우수: 3, 보통: 2, 노력: 1 };
const gradeToScore = (g) => GRADE_SCORE[g] ?? null;

/** 1차→2차 등급 변화를 { dir, label, color } 로 판정. 비교 불가 시 dir='pending' */
const getTrend = (fromGrade, toGrade) => {
  const a = gradeToScore(fromGrade);
  const b = gradeToScore(toGrade);
  if (a == null || b == null) return { dir: 'pending', label: '채점 대기', color: '#94A3B8' };
  if (b > a) return { dir: 'up', label: '향상', color: '#10B981' };
  if (b < a) return { dir: 'down', label: '하락', color: '#EF4444' };
  return { dir: 'same', label: '유지', color: '#64748B' };
};

/** 차수별 AI 채점 최대 횟수 — 1차/2차 각각 독립 카운터 (v2 정책) */
const AI_GRADING_LIMIT_PER_ROUND = 2;

const GradingManagement = ({ activeSubMenu, variant = 'v1' }) => {
  // [SCR-06] v2(채점 관리 2) 여부 — 퇴고 관련 UI/로직 전체의 게이트
  const isV2 = variant === 'v2';
  const screenTitle = isV2 ? '채점 관리 2' : '채점 관리';
  // ── 채점 관리 상태 ──
  const [selectedTask, setSelectedTask] = useState(1);
  // [v3.18] '전체' 탭 폐기 — 기본값 '미채점'
  const [activeTab, setActiveTab] = useState('미채점');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(1);
  const [isScanUploadOpen, setIsScanUploadOpen] = useState(false);

  const [gradingHistory] = useState([
    { id: 1, label: '#1', level: '우수', timestamp: '2025. 11. 21. 오후 03:37', feedback: '이런 점이 좋아요\n삼중류 상황을 수학적인 일차방정식으로 완벽하게 모델링하였습니다. 문제에서 요구하는 \'일곱 건의학\' 원리를 정확히 파악하여 식을 세웠고, 미지수 $a$의 값까지 오류 없이 지선하였습니다.\n\n조금만 더 노력해볼까요\n문제에서 요구한 핵심은 \'일차방정식\'으로 나타내는 것이었습니다. 학생은 방정식을 세우는 것에서 나아가 해($a=8$)를 구하는 과정까지 완벽하게 수행하였습니다.', feedbackSummary: '[분석1] 강점: 일회용 플라스틱 문제에 대한 명확한 이해와 통합적 접근을 보여줌, 논리적이고 체계적인 문제 해결 방안을 제시함 [문장1] 개선점: 구체적인 사례나...' },
    { id: 2, label: '#2', level: '보통', timestamp: '2025. 11. 21. 오후 03:37', feedback: '함께 성장해요\n문제에서 요구한 핵심은 \'일차방정식\'으로 나타내는 것이었습니다.', feedbackSummary: '' }
  ]);
  const [reflectedHistoryId, setReflectedHistoryId] = useState(1);
  const [teacherFinalFeedback, setTeacherFinalFeedback] = useState('');

  // ── 일괄 채점 상태 ──
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState('checking');
  const [bulkStatus, setBulkStatus] = useState('ready');
  const [isNeoStudioInstalled, setIsNeoStudioInstalled] = useState(false);

  // ── 일괄 필기 과정 평가 상태 ──
  const [isBulkHwModalOpen, setIsBulkHwModalOpen] = useState(false);
  const [bulkHwStatus, setBulkHwStatus] = useState('ready'); // 'ready' | 'processing' | 'completed'
  const [bulkHwProgress, setBulkHwProgress] = useState(0);
  const [bulkHwResults, setBulkHwResults] = useState({ success: [], failed: [] });

  // ── 백그라운드 채점 & FAB ──
  const [isConfirmCloseOpen, setIsConfirmCloseOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSelectedIds, setExportSelectedIds] = useState([]);
  const [exportStatus, setExportStatus] = useState('ready'); // ready | processing | done
  const [exportProgress, setExportProgress] = useState(0);
  const [previewStudent, setPreviewStudent] = useState(null);
  // 내보내기 포함 항목 — 교사 피드백은 필수(고정), 문항/답안은 선택
  const [exportContentOptions, setExportContentOptions] = useState({
    question: false,
    answer: false,
    feedback: true
  });
  // [POP-19 v2.2] 출력 형식 — 'pdf'(기본, 학생별 PDF ZIP 묶음) | 'excel'(전체 명단 단일 xlsx)
  const [exportFormat, setExportFormat] = useState('pdf');
  const [showFAB, setShowFAB] = useState(false);
  // [SCR-05 v4.2] 스캔 채점 모달 최소화 — 모달은 mount 상태로 두고 화면에서만 숨겨 진행 상태를 보존한다
  const [scanMinimized, setScanMinimized] = useState(false);
  const [isGradingFinished, setIsGradingFinished] = useState(false);
  // 개별(SCR-02) 백그라운드 채점 상태 — { studentId, studentName, isFinished } | null
  const [bgIndividual, setBgIndividual] = useState(null);
  // 일괄 채점 진행 중 학생 ID 스냅샷 — 카드/리스트에 "채점중..." 표시용
  const [bulkGradingIds, setBulkGradingIds] = useState([]);
  // [v3.x] 최근 일괄 채점 완료된 학생 ID 스냅샷 (선택 순서 유지)
  //   FAB(완료 상태) 클릭 시 첫 성공 학생의 SCR-03 상세 자동 오픈에 사용
  const [lastBulkGradedIds, setLastBulkGradedIds] = useState([]);
  // [v3.16] 스캔 일괄 채점 모달 오픈 상태
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  // SCR-01 채점 관리 학생 목록 뷰 토글 — 'card' | 'list'
  const [gradingViewMode, setGradingViewMode] = useState('card');

  // ── [SCR-06] 퇴고 상태 (v2 전용) ──
  // 퇴고 요청 확인 모달 — 2차 답안지 재배부 안내 + 새 번호표 발급 확인
  const [isRevisionRequestOpen, setIsRevisionRequestOpen] = useState(false);
  // 퇴고 요청 처리 결과 — { count, sheets: [{ name, from, to }] } | null
  const [revisionRequestResult, setRevisionRequestResult] = useState(null);
  // 차수 필터 칩 — 'all'(전체) | '1'(1차) | '2'(퇴고). 전 탭 공통
  const [roundFilter, setRoundFilter] = useState('all');

  // ── 펜 데이터 정렬 상태 ──
  const [penSortBy, setPenSortBy] = useState('none'); // 'none', 'name', 'grade'

  // ── 펜/OCR 데이터 (채점용) ──
  const [updatePercent, setUpdatePercent] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const [penData, setPenData] = useState([
    { id: 'PEN-001', student: '홍길동1 (1학년 1반 1번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-002', student: '홍길동2 (1학년 1반 2번)', status: '펜 연결', data: '데이터 없음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-003', student: '홍길동3 (1학년 1반 3번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.0.5', needsUpdate: true },
    { id: 'PEN-004', student: '홍길동4 (1학년 1반 4번)', status: '그룹 불일치', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isGroupMismatch: true, detectedGroup: '1학년 2반', expectedGroup: '1학년 1반' },
    { id: 'PEN-005', student: '홍길동5 (1학년 1반 5번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-006', student: '홍길동6 (1학년 1반 6번)', status: '그룹 불일치', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isGroupMismatch: true, detectedGroup: '1학년 2반', expectedGroup: '1학년 1반' },
    { id: 'PEN-007', student: '홍길동7 (1학년 1반 7번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
    { id: 'PEN-008', student: '홍길동8 (1학년 1반 8번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
    { id: 'PEN-009', student: '홍길동9 (1학년 1반 9번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-010', student: '홍길동10 (1학년 1반 10번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
  ]);

  // 그룹 불일치 펜 수 계산
  const mismatchedPenCount = penData.filter(p => p.isGroupMismatch).length;

  // 그룹 불일치 펜 일괄 삭제 (프로토타입 동작)
  const removeMismatchedPens = () => {
    setPenData(prev => prev.filter(p => !p.isGroupMismatch));
  };

  const sortedPenData = React.useMemo(() => {
    if (penSortBy === 'none') return penData;

    return [...penData].sort((a, b) => {
      const extract = (s) => {
        const m = s.match(/(.+)\s\((.+)\)/);
        return m ? { name: m[1], grade: m[2] } : { name: s, grade: '' };
      };

      const infoA = extract(a.student);
      const infoB = extract(b.student);

      if (penSortBy === 'name') {
        return infoA.name.localeCompare(infoB.name);
      } else if (penSortBy === 'grade') {
        return infoA.grade.localeCompare(infoB.grade, undefined, { numeric: true });
      }
      return 0;
    });
  }, [penData, penSortBy]);
  const [ocrData, setOcrData] = useState([
    { id: 'OCR-001', name: '홍길동', grade: '1학년 1반 5번', status: '대기 중', progress: 0, source: 'homework_1.jpg', dataStatus: '이미지 확보 완료', fileType: 'JPG (2.1MB)' },
    { id: 'OCR-002', name: '김민지', grade: '1학년 1반 12번', status: '대기 중', progress: 0, source: 'scan_text_2.png', dataStatus: '이미지 확보 완료', fileType: 'PNG (3.4MB)' }
  ]);

  const sortedOcrData = React.useMemo(() => {
    if (penSortBy === 'none') return ocrData;
    return [...ocrData].sort((a, b) => {
      if (penSortBy === 'name') return a.name.localeCompare(b.name);
      if (penSortBy === 'grade') return a.grade.localeCompare(b.grade, undefined, { numeric: true });
      return 0;
    });
  }, [ocrData, penSortBy]);

  // ── 목 데이터 ──
  const tasks = [
    { id: 1, type: '국어', title: '과제테스트', date: '2024.02.23', submissions: '0/10', description: '테스트' },
    { id: 2, type: '수학', title: '오늘 테스트 과제', date: '2024.02.24', submissions: '3/3', description: '오늘 테스트' }
  ];
  // sheets = TSK-02 「답안지 출력 장수 설정」(문항별 기준 장수).
  // 스캔 채점(SCR-05)의 결손 판정 기준으로 사용된다 — 실제 연결 장수가 이 값보다 적으면 누락으로 안내
  const questions = [
    { id: 1, title: '문항 1', score: 30, sheets: 2, description: '작품의 주제를 파악하고 자신의 생각을 서술하시오.' },
    { id: 2, title: '문항 2', score: 30, sheets: 1, description: '주요 등장인물의 심리 변화를 분석하시오.' },
    { id: 3, title: '문항 3', score: 20, sheets: 1, description: '작품의 표현 기법을 분석하시오.' }
  ];
  // [SCR-06] v2 확장 필드 (v1은 참조하지 않으므로 동작 영향 없음)
  //   round      : 현재 채점 차수 (1 = 원본 답안, 2 = 퇴고 답안)
  //   history    : 이전 차수 결과 스냅샷 배열 [{ round, aiGrade, teacherGrade, sheetNo, sentAt }]
  //   aiCount    : 차수별 AI 채점 실행 횟수 { 1: n, 2: n } — 차수별 독립 카운터(최대 2회)
  //   sheetNo    : 현재 차수 답안지 번호표 (2차는 재배부된 새 번호표)
  const [students, setStudents] = useState([
    { id: 11, name: '정지훈', grade: '5학년 2반 3번', submitType: 'pen', aiGrade: '노력', teacherGrade: '보통', status: '채점 확인', round: 1, history: [], aiCount: { 1: 1, 2: 0 }, sheetNo: 'A-0011' },
    { id: 1, name: '김순정', grade: '1학년 1반 1번', submitType: 'pen', aiGrade: '-', teacherGrade: '-', status: '미채점', round: 1, history: [], aiCount: { 1: 0, 2: 0 }, sheetNo: 'A-0001' },
    { id: 2, name: '이순정', grade: '1학년 1반 2번', submitType: 'pen', aiGrade: '-', teacherGrade: '-', status: '미채점', round: 1, history: [], aiCount: { 1: 0, 2: 0 }, sheetNo: 'A-0002' },
    { id: 3, name: '박순정', grade: '1학년 1반 3번', submitType: 'pen', aiGrade: '-', teacherGrade: '-', status: '미채점', round: 1, history: [], aiCount: { 1: 0, 2: 0 }, sheetNo: 'A-0003' },
    { id: 4, name: '홍길동', grade: '1학년 1반 5번', submitType: 'ocr', aiGrade: '-', teacherGrade: '-', status: '미채점', round: 1, history: [], aiCount: { 1: 0, 2: 0 }, sheetNo: 'A-0005' },
    { id: 5, name: '김민지', grade: '1학년 1반 12번', submitType: 'ocr', aiGrade: '-', teacherGrade: '-', status: '미채점', round: 1, history: [], aiCount: { 1: 0, 2: 0 }, sheetNo: 'A-0012' },
    { id: 9, name: '일반테스트', grade: '6학년 1반 1번', submitType: 'pen', aiGrade: '노력', teacherGrade: '노력', status: '결과 발송 완료', round: 1, history: [], aiCount: { 1: 1, 2: 0 }, sheetNo: 'A-0009' },
    { id: 10, name: '이하늘', grade: '4학년 1반 1번', submitType: 'ocr', aiGrade: '노력', teacherGrade: '노력', status: '결과 발송 완료', round: 1, history: [], aiCount: { 1: 2, 2: 0 }, sheetNo: 'A-0010' },
    // [SCR-06] v2 데모용 — 이미 퇴고 사이클을 한 바퀴 돈 학생 (1차 노력 → 2차 보통, 향상)
    { id: 12, name: '최다연', grade: '1학년 1반 7번', submitType: 'pen', aiGrade: '보통', teacherGrade: '보통', status: '결과 발송 완료', round: 2, sheetNo: 'B-0007', aiCount: { 1: 1, 2: 1 }, v2Only: true,
      history: [{ round: 1, aiGrade: '노력', teacherGrade: '노력', sheetNo: 'A-0007', sentAt: '2026.08.12' }] },
    // [SCR-06] v2 데모용 — 퇴고 요청 후 2차 답안 채점 대기 (1차 미채점 학생과 동일한 상태)
    { id: 13, name: '오세림', grade: '1학년 1반 9번', submitType: 'pen', aiGrade: '-', teacherGrade: '-', status: '미채점', round: 2, sheetNo: 'B-0009', aiCount: { 1: 1, 2: 0 }, v2Only: true,
      history: [{ round: 1, aiGrade: '보통', teacherGrade: '보통', sheetNo: 'A-0009', sentAt: '2026.08.13' }] }
  ]);

  // [SCR-06] 화면에 노출할 학생 명단 — v2 전용 데모 학생(`v2Only`)은 v1(기존 채점 관리)에서 숨긴다.
  //   개별 id 조회(`students.find`)는 v1에서 해당 id가 선택될 일이 없으므로 그대로 둔다.
  const roster = React.useMemo(
    () => (isV2 ? students : students.filter(s => !s.v2Only)),
    [students, isV2]
  );

  // [v3.19] 그룹 선택 기본값 — 미채점 학생 중 첫 번째 학생의 그룹을 자동 선택 (mount 1회)
  useEffect(() => {
    if (selectedGroup) return; // 사용자가 이미 변경했으면 skip
    const firstUngraded = students.find(s => s.status === '미채점');
    if (!firstUngraded) return;
    const groupName = firstUngraded.grade.replace(/\s*\d+번\s*$/, '').trim();
    if (groupName) setSelectedGroup(groupName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentTask = tasks.find(t => t.id === selectedTask) || tasks[1];

  // ── 핸들러 ──
  const handleOpenModal = (student) => {
    setSelectedStudent(student);
    setActiveQuestion(1);
    setIsModalOpen(true);
    if (student.status === '채점 확인') {
      setTeacherFinalFeedback('');
      setReflectedHistoryId(1);
    }
  };

  // [v3.18] '전체' 탭 폐기 — 3개 탭 분기 (미채점/채점 확인/결과 발송)
  // [SCR-06] 퇴고는 「단계」가 아니라 학생의 「속성」이므로 별도 탭을 두지 않는다.
  //   퇴고 요청된 학생도 결국 미채점 → 채점 확인 → 결과 발송을 그대로 다시 밟기 때문에,
  //   탭을 추가하면 같은 학생이 두 탭에 동시 집계되어 탭 카운트 합이 실제 인원과 어긋난다.
  //   대신 퇴고 학생도 1차와 똑같이 미채점 → 채점 확인 → 결과 발송을 밟게 하고,
  //   구분은 ① 차수 배지(1차/✍ 2차) ② 차수 필터 칩(전 탭 공통) ③ 점수 추이 비교로만 한다.
  const matchTab = (student, tab) => {
    if (tab === '미채점') return student.status === '미채점';
    if (tab === '채점 확인') return student.status === '채점 확인';
    if (tab === '결과 발송') return student.status === '결과 발송 전' || student.status === '결과 발송 완료';
    return true;
  };

  // [SCR-06] 차수 필터 — 'all' | '1' | '2'. 전 탭 공통으로 적용되며 탭 카운트에도 반영된다.
  //   `2`(퇴고) 선택 시 퇴고 학생이 각 단계에 어떻게 분포하는지가 탭 카운트로 바로 보인다.
  const matchRound = (student) => {
    if (!isV2 || roundFilter === 'all') return true;
    const r = student.round ?? 1;
    return roundFilter === '2' ? r >= 2 : r === 1;
  };

  const filteredStudents = roster.filter(s => matchTab(s, activeTab) && matchRound(s));

  /* [SCR-01 v4.5] 일괄 채점 완료 요약 — SCR-05 스캔 채점의 완료 단계와 같은 지표를 쓴다.
   * 「몇 명이 채점됐고 몇 문항이 처리됐는지」는 경로(펜/스캔)와 무관하게 교사가 확인해야 하는 값이다.
   * `selectedIds`는 완료 시점에 비워지므로 스냅샷인 `lastBulkGradedIds`로 계산한다. */
  const bulkResultStudents = lastBulkGradedIds
    .map((id) => students.find((s) => s.id === id))
    .filter(Boolean);
  const bulkGradedCount = bulkResultStudents.filter((s) => s.status === '채점 확인').length;
  const bulkFailedCount = bulkResultStudents.length - bulkGradedCount;
  const bulkGradedQuestionCount = bulkGradedCount * questions.length;

  // [v3.18] '전체' 탭 라벨 분기 폐기
  const getTabLabel = (label) =>
    `${label}(${roster.filter(s => matchTab(s, label) && matchRound(s)).length})`;

  // ── [SCR-06] 퇴고 파생 데이터 ──
  // 퇴고 대상(1차 결과 발송 완료 + 아직 퇴고 미요청) 중 현재 선택된 학생
  const bulkRevisionRequestIds = isV2
    ? selectedIds.filter(id => {
        const s = students.find(st => st.id === id);
        return s && s.status === '결과 발송 완료' && (s.round ?? 1) === 1;
      })
    : [];

  // [SCR-06] 퇴고 학생 전체(단계 무관)의 점수 추이 요약 — 향상/유지/하락/채점 대기
  const revisionStudents = React.useMemo(
    () => (isV2 ? roster.filter(s => (s.round ?? 1) >= 2) : []),
    [roster, isV2]
  );
  const revisionSummary = React.useMemo(() => {
    const base = { up: 0, same: 0, down: 0, pending: 0 };
    revisionStudents.forEach(s => {
      const first = (s.history || []).find(h => h.round === 1);
      base[getTrend(first?.teacherGrade, s.teacherGrade).dir] += 1;
    });
    return base;
  }, [revisionStudents]);

  const handleBulkGrading = () => {
    if (!selectedGroup || selectedGroup === '그룹 선택') {
      alert('그룹이 선택되어야 일괄 채점을 시작할 수 있습니다.');
      return;
    }
    setIsBulkModalOpen(true);
    setBulkStep('checking');
    setTimeout(() => {
      setBulkStep(isNeoStudioInstalled ? 'instruction' : 'not_installed');
    }, 1500);
  };

  // [v3.16] 스캔 일괄 채점 진입 — 그룹·학생 선택 사전 검증 후 모달 오픈
  const handleScanGrading = () => {
    if (!selectedGroup || selectedGroup === '그룹 선택') {
      alert('그룹이 선택되어야 스캔 채점을 시작할 수 있습니다.');
      return;
    }
    if (!selectedIds.length) {
      alert('스캔 채점 대상 학생을 먼저 선택해 주세요.');
      return;
    }
    setIsScanModalOpen(true);
  };

  // [v3.16] 스캔 채점 완료 콜백 — 연결 완료된 학생 ID 배열 수신
  //   기존 bulk 완료 로직과 동일한 상태 전환 + FAB 흐름 재사용 (완료 즉시 FAB 노출)
  const handleScanCompleted = (matchedStudentIds) => {
    setStudents(prev => prev.map(s => {
      if (matchedStudentIds.includes(s.id)) {
        const r = s.round ?? 1;
        return {
          ...s,
          status: '채점 확인',
          aiGrade: '보통',
          // [SCR-06] 스캔 채점도 차수별 AI 채점 카운터를 공유 (경로 무관, 차수 단위로만 독립)
          aiCount: { ...(s.aiCount || { 1: 0, 2: 0 }), [r]: (s.aiCount?.[r] ?? 0) + 1 },
        };
      }
      return s;
    }));
    setLastBulkGradedIds([...matchedStudentIds]);
    setSelectedIds([]);
    setBulkGradingIds([]);
    // [SCR-05 v4.2] [확인] → 세션 종료 + 「채점 확인」 탭으로 이동. FAB는 여기서 내린다
    setIsScanModalOpen(false);
    setScanMinimized(false);
    setShowFAB(false);
    setIsGradingFinished(false);
    setActiveTab('채점 확인');
  };

  // [SCR-05 v4.2] 스캔 모달 최소화 — 채점 중/완료 상태에서 창을 닫으면 FAB로 내려간다
  const handleScanMinimize = ({ finished }) => {
    setScanMinimized(true);
    setIsGradingFinished(!!finished);
    setShowFAB(true);
  };

  const toggleAll = () => {
    const visibleIds = filteredStudents.map(s => s.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id));
    if (allSelected) {
      setSelectedIds(selectedIds.filter(id => !visibleIds.includes(id)));
    } else {
      setSelectedIds([...new Set([...selectedIds, ...visibleIds])]);
    }
  };

  const toggleStudent = (id) => {
    if (selectedIds.includes(id)) setSelectedIds(selectedIds.filter(sid => sid !== id));
    else setSelectedIds([...selectedIds, id]);
  };

  // ── 일괄 필기 과정 평가 ──
  const bulkHwEligibleIds = selectedIds.filter(id => {
    const s = students.find(st => st.id === id);
    return s && (s.status === '채점 확인' || s.status === '결과 발송 전' || s.status === '결과 발송 완료');
  });

  const handleBulkHandwritingEvaluation = () => {
    const eligible = bulkHwEligibleIds;
    const ineligibleCount = selectedIds.length - eligible.length;
    if (eligible.length === 0) {
      alert('AI 등급평가가 완료된 학생만 과정평가를 실행할 수 있습니다.');
      return;
    }
    if (ineligibleCount > 0) {
      const proceed = window.confirm(
        `선택된 ${selectedIds.length}명 중 ${ineligibleCount}명은 AI 등급평가 미완료 상태입니다.\nAI 등급평가가 완료된 ${eligible.length}명만 과정평가됩니다. 계속하시겠습니까?`
      );
      if (!proceed) return;
    }
    setIsBulkHwModalOpen(true);
    setBulkHwStatus('processing');
    setBulkHwProgress(0);
    setBulkHwResults({ success: [], failed: [] });

    const total = eligible.length;
    let step = 0;
    const interval = setInterval(() => {
      step++;
      setBulkHwProgress(Math.round((step / total) * 100));
      if (step >= total) {
        clearInterval(interval);
        const success = [];
        const failed = [];
        eligible.forEach((id, idx) => {
          const student = students.find(s => s.id === id);
          if (idx % 5 === 4) {
            failed.push({ id, name: student?.name || '', reason: '필기 데이터 부족' });
          } else {
            success.push(id);
          }
        });
        const patterns = [
          {
            processPattern: '신중한 재구조화형',
            metricsCode: 'Time-c, Coord-a, Press-a',
            gradeLevel: 'Excellent (A)',
            diagnosedPattern: '신중한 재구조화형',
            totalEvaluation: "학생의 풀이 과정을 데이터로 분석한 결과, 이 패턴은 '신중한 재구조화형'으로 진단됩니다. 조합의 공식 유도 과정을 논리적으로 전개하는 과정에서 특정 구간에 깊은 고민의 흔적이 보이나, 결국 이전 수식을 보완하고 논리적 오류를 스스로 바로잡아 완벽한 증명을 완성해냈습니다.",
            whatsGood: '조합의 공식 유도 과정을 단계별로 매우 정석적으로 서술하였습니다. 특히 분수식의 통분 과정에서 공통인수를 묶어내고 식을 간결하게 정리하는 능력이 매우 탁월합니다.',
            whatNeedsWork: '전반적인 논리 흐름은 완벽하나, 중간 단계에서 식을 전개할 때 다소 긴 시간 동안 멈춤(Time-c)이 발생했습니다.',
            letsGrowTogether: '증명 문제의 경우 각 단계에서 사용되는 공식을 미리 머릿속으로 구조화한 뒤 펜을 잡는 연습을 해보세요.',
            contentBottleneckAnalysis: '행동 지표 분석: 전반적으로 필압(Press-a)이 일정하고 강하게 유지되어 개념에 대한 확신이 있음을 보여줍니다.\n\n병목 구간 진단: 풀이 중간, 두 분수식을 통분하여 하나의 식으로 합치는 과정 전후로 약 2.5초 이상의 긴 멈춤이 감지되었습니다.'
          },
          {
            processPattern: 'c-c-b 시행착오 탐색형',
            metricsCode: 'Time-c, Coord-c, Press-b',
            gradeLevel: 'Good (B)',
            diagnosedPattern: '시행착오 탐색형',
            totalEvaluation: '여러 번 식을 다시 세우고 오류를 수정하려는 끈기 있는 태도를 보였으나, 개념 적용 단계에서 인지적 과부하가 발생한 패턴입니다.',
            whatsGood: '문제를 해결하기 위해 여러 번 식을 다시 세우고, 계산 과정에서 오류를 발견했을 때 이를 수정하려는 끈기 있는 태도가 매우 훌륭합니다.',
            whatNeedsWork: '풀이 과정에서 동일한 수식을 여러 번 반복하거나, 지우고 다시 쓰는 과정에서 풀이의 흐름이 다소 산만해졌습니다.',
            letsGrowTogether: '다음에는 문제를 풀기 전, 구해야 하는 값과 주어진 조건을 먼저 메모하고 1분만 계획을 세워보세요.',
            contentBottleneckAnalysis: '행동 패턴 진단: Time-c(긴 멈춤), Coord-c(중첩/수정), Press-b(자연스러운 굴곡)가 결합된 시행착오 탐색형입니다.\n\n병목 구간 진단: 개념 적용 단계에서 수 초간의 긴 멈춤이 감지되었습니다.'
          }
        ];

        setStudents(prev => prev.map(s => {
          if (success.includes(s.id)) {
            const p = patterns[s.id % patterns.length];
            return {
              ...s,
              handwritingEvaluation: {
                systemDataLog: {
                  processPattern: p.processPattern,
                  metricsCode: p.metricsCode,
                  gradeLevel: p.gradeLevel
                },
                evaluationSummary: {
                  diagnosedPattern: p.diagnosedPattern,
                  totalEvaluation: p.totalEvaluation
                },
                finalFeedback: {
                  whatsGood: p.whatsGood,
                  whatNeedsWork: p.whatNeedsWork,
                  letsGrowTogether: p.letsGrowTogether,
                  contentBottleneckAnalysis: p.contentBottleneckAnalysis
                }
              }
            };
          }
          return s;
        }));
        setBulkHwResults({ success, failed });
        setBulkHwStatus('completed');
      }
    }, 300);
  };

  const handleHandwritingEvaluated = (studentId, result) => {
    setStudents(prev => prev.map(s =>
      s.id === studentId ? { ...s, handwritingEvaluation: result } : s
    ));
    setSelectedStudent(prev => prev && prev.id === studentId
      ? { ...prev, handwritingEvaluation: result }
      : prev
    );
  };

  // ── 일괄 검토 완료 처리 ──
  const bulkReviewCompleteIds = selectedIds.filter(id => {
    const s = students.find(st => st.id === id);
    return s && s.status === '채점 확인';
  });

  // 미채점 처리는 일괄 액션 미제공 — SCR-03 상세 모달에서 학생 단위로만 처리 (PRD v3.16)

  const handleBulkReviewComplete = () => {
    if (bulkReviewCompleteIds.length === 0) return;
    const proceed = window.confirm(
      `선택된 ${bulkReviewCompleteIds.length}명의 채점을 검토 완료 처리하시겠습니까?\n완료된 학생은 '결과 발송' 탭으로 이동합니다.`
    );
    if (!proceed) return;
    setStudents(prev => prev.map(s =>
      bulkReviewCompleteIds.includes(s.id)
        ? { ...s, status: '결과 발송 전' }
        : s
    ));
    setSelectedIds(prev => prev.filter(id => !bulkReviewCompleteIds.includes(id)));
  };

  // ── 결과 발송 단계: 일괄 발송 / 재검토 / 취소 ──
  const bulkPreSendIds = selectedIds.filter(id => {
    const s = students.find(st => st.id === id);
    return s && s.status === '결과 발송 전';
  });
  const bulkSentIds = selectedIds.filter(id => {
    const s = students.find(st => st.id === id);
    return s && s.status === '결과 발송 완료';
  });

  const handleBulkResultSend = () => {
    if (bulkPreSendIds.length === 0) return;
    const proceed = window.confirm(`선택된 ${bulkPreSendIds.length}명에게 결과를 발송하시겠습니까?`);
    if (!proceed) return;
    setStudents(prev => prev.map(s => bulkPreSendIds.includes(s.id) ? { ...s, status: '결과 발송 완료' } : s));
    setSelectedIds([]);
    alert(`${bulkPreSendIds.length}명에게 결과가 발송되었습니다.`);
  };

  const handleBulkSendCancel = () => {
    if (bulkSentIds.length === 0) return;
    const proceed = window.confirm(`선택된 ${bulkSentIds.length}명의 결과 발송을 취소하시겠습니까?`);
    if (!proceed) return;
    setStudents(prev => prev.map(s => bulkSentIds.includes(s.id) ? { ...s, status: '결과 발송 전' } : s));
    setSelectedIds([]);
  };

  const handleRevertToReview = () => {
    if (bulkPreSendIds.length !== 1) return;
    const target = students.find(s => s.id === bulkPreSendIds[0]);
    if (!target) return;
    const proceed = window.confirm(`${target.name} 학생을 '채점 확인' 단계로 되돌리시겠습니까?`);
    if (!proceed) return;
    setStudents(prev => prev.map(s => s.id === target.id ? { ...s, status: '채점 확인' } : s));
    setSelectedIds([]);
  };

  // ─────────────────────────────────────────────
  // [SCR-06] 퇴고 핸들러 (v2 전용)
  // ─────────────────────────────────────────────

  /** 새 번호표 발급 — 1차 `A-nnnn` → 2차 `B-nnnn` (프로토타입 규칙) */
  const issueRevisionSheetNo = (sheetNo) =>
    sheetNo ? sheetNo.replace(/^A-/, 'B-') : 'B-0000';

  /**
   * [✍ 퇴고 요청] 확정 —
   *  ① 1차 결과를 history에 스냅샷으로 보존 (펜 데이터 삭제 없음)
   *  ② round를 2로 올리고 새 번호표(2차 답안지) 발급
   *  ③ 현재 차수 채점값을 초기화하고 `미채점`으로 되돌려 1차와 동일한 채점 플로우에 태운다
   */
  const applyRevisionRequest = (targetIds) => {
    const targets = students.filter(s => targetIds.includes(s.id));
    if (targets.length === 0) return;

    const sheets = targets.map(s => ({
      name: s.name,
      from: s.sheetNo,
      to: issueRevisionSheetNo(s.sheetNo),
    }));

    setStudents(prev => prev.map(s => {
      if (!targetIds.includes(s.id)) return s;
      return {
        ...s,
        round: 2,
        sheetNo: issueRevisionSheetNo(s.sheetNo),
        history: [
          ...(s.history || []),
          {
            round: s.round ?? 1,
            aiGrade: s.aiGrade,
            teacherGrade: s.teacherGrade,
            sheetNo: s.sheetNo,
            sentAt: currentTask.date,
          },
        ],
        // 2차 채점값 초기화 — 1차 결과는 history에 보존되어 있으므로 손실 없음
        aiGrade: '-',
        teacherGrade: '-',
        // [SCR-06] `답안 있음` 배지는 「채점 전이지만 답안이 이미 제출됨」을 뜻한다.
        //   퇴고 요청 직후에는 2차 답안이 아직 없으므로 1차의 제출 경로를 물려받으면 안 된다.
        //   2차 제출 경로(펜/스캔)는 실제 채점 시점에 다시 정해진다.
        submitType: 'pen',
        handwritingEvaluation: undefined,
        // [SCR-06] 퇴고 학생도 1차와 완전히 같은 `미채점`으로 들어간다.
        //   1차에도 「답안지 배부 → 학생 작성 → 펜 동기화」 과정이 있지만 별도 상태를 두지 않으므로,
        //   퇴고에만 대기 상태·수집 게이트를 두면 채점 동선이 갈라진다.
        status: '미채점',
      };
    }));

    setRevisionRequestResult({ count: targets.length, sheets });
    setSelectedIds([]);
    setIsRevisionRequestOpen(false);
    // [SCR-06] 퇴고 요청 학생은 `미채점`으로 내려간다. 해당 학생만 바로 보이도록 미채점 탭 + 퇴고 필터 적용
    setActiveTab('미채점');
    setRoundFilter('2');
  };

  /** 목록 [✍ 퇴고 요청 (N명)] — 선택된 학생 일괄 */
  const handleConfirmRevisionRequest = () => applyRevisionRequest(bulkRevisionRequestIds);

  /** SCR-03 상세 [✍ 퇴고 요청] — 학생 단위. 처리 후 상세 모달을 닫고 미채점 탭 + 퇴고 필터로 이동 */
  const handleRevisionRequestFromDetail = (student) => {
    if (!student) return;
    applyRevisionRequest([student.id]);
    setIsModalOpen(false);
  };

  /** 차수별 AI 채점 잔여 횟수 — 1차/2차 독립 카운터 (v2 정책) */
  const getRemainingAiCount = (student) => {
    const r = student.round ?? 1;
    const used = student.aiCount?.[r] ?? 0;
    return Math.max(0, AI_GRADING_LIMIT_PER_ROUND - used);
  };

  const startFirmwareUpdate = () => {
    setIsUpdating(true);
    let progress = 0;
    const interval = setInterval(() => {
      progress += 5;
      setUpdatePercent(progress);
      if (progress >= 100) {
        clearInterval(interval);
        setIsUpdating(false);
        setPenData(prev => prev.map(p => p.id === 'PEN-003' ? { ...p, firmware: '2.1.0 (최신)', needsUpdate: false, updating: false } : p));
      }
    }, 100);
    setPenData(prev => prev.map(p => p.id === 'PEN-003' ? { ...p, updating: true } : p));
  };

  const startGrading = () => {
    setBulkStatus('processing');
    // 카드/리스트 "채점중..." 표시용 스냅샷 (선택된 학생 ID들)
    setBulkGradingIds([...selectedIds]);
    setPenData([
      { id: 'PEN-001', student: '홍길동1 (1학년 1반 1번)', status: 'AI 채점중', progress: 40, data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-002', student: '홍길동2 (1학년 1반 2번)', status: 'AI 채점중', progress: 85, data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-003', student: '홍길동3 (1학년 1반 3번)', status: 'AI 채점 완료', data: '데이터 삭제', battery: '85%', firmware: '2.1.0 (최신)', completed: true },
      { id: 'PEN-005', student: '홍길동5 (1학년 1반 5번)', status: '채점 실패', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isError: true },
      { id: 'PEN-006', student: '홍길동6 (1학년 1반 6번)', status: 'AI 채점중', progress: 60, data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-007', student: '홍길동7 (1학년 1반 7번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
      { id: 'PEN-008', student: '홍길동8 (1학년 1반 8번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
      { id: 'PEN-009', student: '홍길동9 (1학년 1반 9번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-010', student: '홍길동10 (1학년 1반 10번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    ]);
    setOcrData([
      { id: 'OCR-001', name: '홍길동', grade: '1학년 1반 5번', status: 'AI 채점중', progress: 40, source: 'homework_1.jpg', dataStatus: 'OCR 추출 중...', fileType: 'JPG (2.1MB)' },
      { id: 'OCR-002', name: '김민지', grade: '1학년 1반 12번', status: 'AI 채점중', progress: 85, source: 'scan_text_2.png', dataStatus: 'OCR 추출 완료', fileType: 'PNG (3.4MB)' }
    ]);
    setTimeout(() => {
      setIsGradingFinished(true);
      setBulkStatus('completed');
      setPenData(prev => prev.map((p, idx) => ({
        ...p,
        status: idx % 4 === 0 ? '채점 실패' : 'AI 채점 완료',
        data: idx % 4 === 0 ? '데이터 있음' : '데이터 삭제',
        progress: 100,
        completed: idx % 4 !== 0,
        isWarning: false,
        isError: idx % 4 === 0
      })));
      setOcrData(prev => prev.map(o => ({ ...o, status: 'AI 채점 완료', progress: 100, dataStatus: '텍스트 변환 성공' })));
      setStudents(prev => prev.map(s => {
        if (selectedIds.includes(s.id)) {
          if (s.id === 3) return s;
          // [SCR-06] 2차(퇴고) 채점은 1차보다 한 등급 향상된 결과를 목으로 생성해 추이 비교를 확인할 수 있게 한다.
          const r = s.round ?? 1;
          const nextAiGrade = r >= 2 ? '보통' : '노력';
          return {
            ...s,
            status: '채점 확인',
            aiGrade: nextAiGrade,
            // 차수별 독립 카운터 증가 (1차/2차 각각 최대 2회)
            aiCount: { ...(s.aiCount || { 1: 0, 2: 0 }), [r]: (s.aiCount?.[r] ?? 0) + 1 },
          };
        }
        return s;
      }));
      // [v3.x] FAB(완료 상태) 클릭 시 첫 성공 학생 SCR-03 오픈용 스냅샷 저장
      //   선택 순서 유지 (id === 3 실패 케이스도 포함 — 클릭 핸들러에서 상태 확인 후 필터)
      setLastBulkGradedIds([...selectedIds]);
      setSelectedIds([]);
      setBulkGradingIds([]); // 카드/리스트 "채점중..." 표시 해제
    }, 5000);
  };

  const handleCloseProcessing = () => {
    if (bulkStatus === 'processing') {
      setIsConfirmCloseOpen(true);
    } else {
      setIsBulkModalOpen(false);
      setActiveTab('미채점');
      setBulkStatus('ready');
      setIsGradingFinished(false);
    }
  };

  const proceedToBackground = () => {
    setIsConfirmCloseOpen(false);
    setIsBulkModalOpen(false);
    setShowFAB(true);
  };

  // 백그라운드 채점(일괄 또는 개별)이 진행 중인지 — 진행 중에는 학생 체크/일괄 작업 버튼 모두 차단
  const isAnyBgActive = showFAB || !!bgIndividual;

  // 일괄 채점 진행 중 페이지 이탈(새로고침/탭 닫기/메뉴 이동) 차단
  useEffect(() => {
    const inProgress = bulkStatus === 'processing' || !!bgIndividual;
    if (!inProgress) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '페이지를 벗어나면 채점 결과를 잃을 수 있습니다. 정말 이동하시겠습니까?';
      return e.returnValue;
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [bulkStatus, bgIndividual]);

  // ─────────────────────────────────────────────
  // [SCR-06] 퇴고 렌더 헬퍼 (v2 전용) — 카드/리스트 양쪽에서 공용
  // ─────────────────────────────────────────────

  /** 차수 배지 — `1차` / `2차`. v2에서만 노출 */
  const renderRoundBadge = (student) => {
    if (!isV2) return null;
    const r = student.round ?? 1;
    const isRevision = r >= 2;
    return (
      <span
        className="card-badge"
        title={`${r}차 답안 · 답안지 번호표 ${student.sheetNo || '-'}`}
        style={{
          background: isRevision ? '#F5F3FF' : '#F1F5F9',
          color: isRevision ? '#7C3AED' : '#64748B',
          fontWeight: 800,
        }}
      >
        {isRevision ? '✍ 2차' : '1차'}
      </span>
    );
  };

  /** 1차→2차 등급 추이 칩. 퇴고 이력이 없으면 렌더하지 않음 */
  const renderTrendChip = (student) => {
    if (!isV2) return null;
    const first = (student.history || []).find(h => h.round === 1);
    if (!first) return null;
    const trend = getTrend(first.teacherGrade, student.teacherGrade);
    const arrow = { up: '▲', down: '▼', same: '－', pending: '…' }[trend.dir];
    return (
      <span
        title={`1차 ${first.teacherGrade} → 2차 ${student.teacherGrade === '-' ? '채점 전' : student.teacherGrade}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: 'var(--neo-font-size-xs)', fontWeight: 800,
          color: trend.color, whiteSpace: 'nowrap',
        }}
      >
        {first.teacherGrade} → {student.teacherGrade === '-' ? '—' : student.teacherGrade}
        <span aria-hidden="true">{arrow}</span>
        <span>{trend.label}</span>
      </span>
    );
  };

  // ── 렌더 ──
  return (
    <>
      {(activeSubMenu === '채점 관리' || activeSubMenu === '채점 관리 2') ? (
        <>
          <header className="content-header">
            {/* [v3.23] 페이지 타이틀과 개인정보 보호 안내를 같은 행에 배치 — 타이틀 옆 인라인 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <div className="page-title">{screenTitle}</div>
              {/* [SCR-06] v2 식별 배지 — 기존 채점 관리와 혼동 방지 */}
              {isV2 && (
                <span style={{
                  background: '#F5F3FF', color: '#7C3AED', border: '1px solid #DDD6FE',
                  borderRadius: 999, padding: '3px 10px', fontWeight: 800,
                  fontSize: 'var(--neo-font-size-xs)', whiteSpace: 'nowrap',
                }}>
                  ✍ 퇴고 지원
                </span>
              )}
              <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '8px', padding: '0.4rem 0.75rem', display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                <span style={{ fontSize: 'var(--neo-font-size-base)', flexShrink: 0 }}>🔒</span>
                <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#166534', lineHeight: 1.4, margin: 0 }}>
                  <strong>AI 채점에는 학생 답안 내용만 전송</strong>되며, 이름·학번 등 <strong>개인 식별 정보는 포함되지 않습니다.</strong>
                </p>
              </div>
            </div>
            {/* [SCR-06] v2 정책 안내 — 기존 [↺ 미채점 처리]와의 차이를 명시 */}
            {isV2 && (
              <div style={{
                marginTop: 10, background: '#FAF5FF', border: '1px solid #E9D5FF',
                borderRadius: 8, padding: '0.6rem 0.85rem',
                fontSize: 'var(--neo-font-size-sm)', color: '#6B21A8', lineHeight: 1.6,
              }}>
                <strong>퇴고</strong>는 결과 발송 완료된 학생에게 <strong>2차 답안지를 재배부</strong>해 다시 쓰게 하는 기능입니다.
                1차 펜 데이터는 <strong>삭제되지 않고 차수 이력으로 보존</strong>되며, AI 채점 횟수는
                <strong> 1차 · 2차 각각 최대 {AI_GRADING_LIMIT_PER_ROUND}회</strong>로 독립 관리됩니다.
                <span style={{ color: '#94A3B8' }}> (펜 데이터를 폐기하는 [↺ 미채점 처리]와는 다른 액션입니다.)</span>
              </div>
            )}
          </header>

          <div className="content-body">
            {/* 과제 선택 사이드바 */}
            <aside className="sub-sidebar">
              <div className="sub-sidebar-header">
                <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, marginBottom: '0.75rem', color: '#1E2225' }}>과제 선택</div>
                <div className="search-box">
                  <input type="text" placeholder="과제명 / 교과 검색" />
                  <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.3 }}>🔍</span>
                </div>
              </div>
              <div className="task-list">
                {tasks.map(task => (
                  <div
                    key={task.id}
                    className={`task-item ${selectedTask === task.id ? 'active' : ''}`}
                    onClick={() => setSelectedTask(task.id)}
                  >
                    <span className="tag">[{task.type}]</span>
                    <span className="title">{task.title}</span>
                    <div className="meta">
                      <span>{task.date}</span>
                      <span style={{ color: 'var(--primary)', fontWeight: 800 }}>제출 {task.submissions}</span>
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            {/* 상세 채점 관리 영역 */}
            <section className="detail-view">
              <div className="task-info-banner" style={{ borderBottom: '1px solid #F3F4F6', paddingBottom: '1.5rem' }}>
                <div className="info-left">
                  <h2 style={{ fontSize: 'var(--neo-font-size-xl)', fontWeight: 800 }}>[{currentTask.type}] {currentTask.title}</h2>
                  <div className="stats-summary" style={{ fontSize: 'var(--neo-font-size-sm)', color: '#8A94A1' }}>
                    배포일: {currentTask.date} ∙ 1개 그룹 ∙ {roster.length}명
                    <button className="btn-card-detail" style={{ width: 'auto', height: 'auto', padding: '2px 8px', marginLeft: '10px', fontSize: 'var(--neo-font-size-xs)', borderRadius: '4px' }}>과제 상세보기 &gt;</button>
                  </div>
                </div>
                <div className="info-right">
                  <div className="stat-item" style={{ color: '#4E5968' }}>제출률 <span className="stat-value" style={{ color: 'var(--primary)', fontWeight: 800 }}>0%</span></div>
                  <div className="stat-item" style={{ color: '#4E5968' }}>완료율 <span className="stat-value" style={{ color: 'var(--primary)', fontWeight: 800 }}>100%</span></div>
                  <button
                    className="btn-primary"
                    style={{ padding: '8px 16px', fontSize: 'var(--neo-font-size-base)' }}
                    onClick={() => {
                      const eligible = roster.filter(s => s.status === '결과 발송 전' || s.status === '결과 발송 완료');
                      if (eligible.length === 0) {
                        alert('결과 발송 단계의 학생이 없습니다.');
                        return;
                      }
                      setExportSelectedIds(eligible.map(s => s.id));
                      setExportStatus('ready');
                      setExportProgress(0);
                      setIsExportModalOpen(true);
                    }}
                  >
                    채점 결과 내보내기
                  </button>
                </div>
              </div>

              {/* [v3.18] control-bar 2단 레이아웃 — 1단: 탭 필터 (전체 탭 폐기, 3개) / 2단: 그룹 선택·전체 선택·일괄 채점·뷰 토글 */}
              <div className="control-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
                <div className="tabs">
                  {['미채점', '채점 확인', '결과 발송'].map(tab => (
                    <div
                      key={tab}
                      className={`tab ${activeTab === tab ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {getTabLabel(tab)}
                    </div>
                  ))}
                </div>
                <div className="view-controls" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', rowGap: 8 }}>
                  {/* [SCR-06] 차수 필터 칩 — 전 탭 공통. 퇴고를 별도 탭이 아닌 「학생 속성 필터」로 다룬다.
                      선택 시 탭 카운트도 함께 좁혀져, 퇴고 학생이 각 단계에 몇 명씩 있는지 바로 읽힌다. */}
                  {isV2 && (
                    <div
                      role="group"
                      aria-label="차수 필터"
                      style={{ display: 'inline-flex', gap: 4, padding: 3, background: '#F1F5F9', borderRadius: 999 }}
                    >
                      {/* 칩에는 숫자를 넣지 않는다 —
                          「퇴고 N」이 「퇴고 N차」로 읽히고(이 기능에 1차/2차 개념이 실제로 있음),
                          칩(전 단계 합계)과 탭(단계별)이 서로 다른 기준의 숫자라 함께 놓으면 혼동된다.
                          퇴고 학생 수는 탭 카운트와 점수 추이 배너가 이미 책임진다. */}
                      {[
                        { key: 'all', label: '전체', title: '1차·퇴고 학생을 모두 표시' },
                        { key: '1', label: '1차', title: '퇴고를 거치지 않은 원본 답안 학생만 표시' },
                        { key: '2', label: '✍ 퇴고', title: '퇴고 요청된 학생만 표시 — 탭 카운트가 단계별 인원으로 바뀝니다' },
                      ].map(chip => {
                        const active = roundFilter === chip.key;
                        return (
                          <button
                            key={chip.key}
                            type="button"
                            aria-pressed={active}
                            title={chip.title}
                            onClick={() => { setRoundFilter(chip.key); setSelectedIds([]); }}
                            style={{
                              padding: '5px 14px', borderRadius: 999, border: 'none', cursor: 'pointer',
                              fontFamily: 'inherit', fontSize: 'var(--neo-font-size-sm)', fontWeight: 800,
                              background: active ? (chip.key === '2' ? '#7C3AED' : '#FFFFFF') : 'transparent',
                              color: active ? (chip.key === '2' ? '#FFFFFF' : '#1E2225') : '#64748B',
                              boxShadow: active && chip.key !== '2' ? '0 1px 2px rgba(15,23,42,0.12)' : 'none',
                            }}
                          >
                            {chip.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {/* [v2.x] 자연 흐름: 그룹 선택 → 전체 선택 → 일괄 채점 → 뷰 토글 */}
                  <select
                    className="select-box"
                    value={selectedGroup}
                    onChange={(e) => setSelectedGroup(e.target.value)}
                  >
                    <option>그룹 선택</option>
                    <option>전체 그룹</option>
                    <option>1학년 1반</option>
                    <option>1학년 2반</option>
                  </select>
                  <label
                    className="select-all-wrapper"
                    style={isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                    title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={filteredStudents.length > 0 && filteredStudents.every(s => selectedIds.includes(s.id))}
                      onChange={toggleAll}
                      disabled={isAnyBgActive}
                    />
                    전체 선택
                  </label>
                  {/* [v3.20] 모든 탭의 일괄 액션 버튼을 view-controls로 통합 — 1명 이상 선택 시 탭별 조건에 따라 노출 */}
                  {/* 미채점 탭 — 일괄 채점 */}
                  {activeTab === '미채점' && selectedIds.length > 0 && (
                    <button
                      className="btn-bulk-grading"
                      onClick={handleBulkGrading}
                      disabled={isAnyBgActive}
                      style={isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
                      title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                    >
                      일괄 채점 ({selectedIds.length}명)
                    </button>
                  )}
                  {/* [v3.16] 미채점 탭 — 스캔 채점 (스캔 파일 업로드 → OCR 학생 번호 연결 → AI 일괄 채점) */}
                  {activeTab === '미채점' && selectedIds.length > 0 && (
                    <button
                      className="btn-bulk-grading"
                      onClick={handleScanGrading}
                      disabled={isAnyBgActive}
                      style={{ background: '#0EA5E9', ...(isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : '스캔 파일을 업로드하면 답안지의 학생 번호 OCR로 자동 연결해 채점합니다.'}
                    >
                      📷 스캔 채점 ({selectedIds.length}명)
                    </button>
                  )}
                  {/* 채점 확인 탭 — 검토 완료 처리 */}
                  {bulkReviewCompleteIds.length > 0 && (
                    <button
                      className="btn-bulk-grading"
                      style={{ background: '#E8590C', ...(isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      onClick={handleBulkReviewComplete}
                      disabled={isAnyBgActive}
                      title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                    >
                      ✓ 검토 완료 처리 ({bulkReviewCompleteIds.length}명)
                    </button>
                  )}
                  {/* 채점 확인·결과 발송 탭 (수학 한정) — 일괄 과정평가 */}
                  {activeTab !== '미채점' && bulkHwEligibleIds.length > 0 && currentTask.type === '수학' && (
                    <button
                      className="btn-bulk-grading"
                      style={{ background: '#8B5CF6', ...(isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      onClick={handleBulkHandwritingEvaluation}
                      disabled={isAnyBgActive}
                      title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                    >
                      ✎ 일괄 과정평가 ({bulkHwEligibleIds.length}명)
                    </button>
                  )}
                  {/* 결과 발송 탭 — 결과발송 */}
                  {bulkPreSendIds.length > 0 && (
                    <button
                      className="btn-bulk-grading"
                      style={{ background: '#2A75F3', ...(isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      onClick={handleBulkResultSend}
                      disabled={isAnyBgActive}
                      title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                    >
                      📤 결과발송 ({bulkPreSendIds.length}명)
                    </button>
                  )}
                  {/* 결과 발송 전 단일 선택 — AI 재검토 */}
                  {bulkPreSendIds.length === 1 && (
                    <button
                      className="btn-bulk-grading"
                      style={{ background: 'white', color: '#EF4444', border: '1px solid #EF4444', ...(isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      onClick={handleRevertToReview}
                      disabled={isAnyBgActive}
                      title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                    >
                      ↩ AI 재검토 (1명)
                    </button>
                  )}
                  {/* 결과 발송 완료 — 결과발송 취소 */}
                  {bulkSentIds.length > 0 && (
                    <button
                      className="btn-bulk-grading"
                      style={{ background: '#EF4444', ...(isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      onClick={handleBulkSendCancel}
                      disabled={isAnyBgActive}
                      title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                    >
                      🚫 결과발송 취소 ({bulkSentIds.length}명)
                    </button>
                  )}
                  {/* [SCR-06] 결과 발송 완료(1차) — 퇴고 요청 */}
                  {isV2 && bulkRevisionRequestIds.length > 0 && (
                    <button
                      className="btn-bulk-grading"
                      style={{ background: '#7C3AED', ...(isAnyBgActive ? { opacity: 0.5, cursor: 'not-allowed' } : {}) }}
                      onClick={() => setIsRevisionRequestOpen(true)}
                      disabled={isAnyBgActive}
                      title={isAnyBgActive
                        ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.'
                        : '1차 결과를 보존한 채 2차 답안지를 재배부합니다.'}
                    >
                      ✍ 퇴고 요청 ({bulkRevisionRequestIds.length}명)
                    </button>
                  )}
                  {/* [v3.18] 카드/목록 토글은 view-controls 우측 끝 — marginLeft: auto로 좌측 그룹과 분리 */}
                  <div
                    className={`btn-icon ${gradingViewMode === 'card' ? 'active' : ''}`}
                    onClick={() => setGradingViewMode('card')}
                    role="button"
                    aria-pressed={gradingViewMode === 'card'}
                    title="카드 보기"
                    style={{ marginLeft: 'auto' }}
                  >
                    ▦
                  </div>
                  <div
                    className={`btn-icon ${gradingViewMode === 'list' ? 'active' : ''}`}
                    onClick={() => setGradingViewMode('list')}
                    role="button"
                    aria-pressed={gradingViewMode === 'list'}
                    title="목록 보기"
                  >
                    ☰
                  </div>
                </div>
              </div>

              {/* [SCR-06] 점수 추이 요약 배너 — 퇴고 필터를 켰을 때만 노출.
                  집계 대상은 현재 탭이 아니라 퇴고 학생 전체이므로, 어느 단계에서 켜도 같은 값을 본다. */}
              {isV2 && roundFilter === '2' && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  margin: '0 0 14px', padding: '12px 14px',
                  background: '#FAF5FF', border: '1px solid #E9D5FF', borderRadius: 10,
                }}>
                  <span style={{ fontWeight: 800, color: '#6B21A8', fontSize: 'var(--neo-font-size-sm)' }}>
                    ✍ 퇴고 점수 추이
                  </span>
                  <span style={{ color: '#C4B5FD' }}>|</span>
                  {[
                    { key: 'up', label: '향상', color: '#10B981', bg: '#ECFDF5' },
                    { key: 'same', label: '유지', color: '#64748B', bg: '#F1F5F9' },
                    { key: 'down', label: '하락', color: '#EF4444', bg: '#FEF2F2' },
                    { key: 'pending', label: '채점 대기', color: '#94A3B8', bg: '#F8FAFC' },
                  ].map(item => (
                    <span
                      key={item.key}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        background: item.bg, color: item.color,
                        borderRadius: 999, padding: '4px 12px',
                        fontWeight: 800, fontSize: 'var(--neo-font-size-sm)',
                      }}
                    >
                      {item.label}
                      <strong style={{ fontSize: 'var(--neo-font-size-base)' }}>{revisionSummary[item.key]}</strong>명
                    </span>
                  ))}
                  <span style={{
                    marginLeft: 'auto', color: '#8A94A1',
                    fontSize: 'var(--neo-font-size-xs)',
                  }}>
                    {/* 탭 카운트는 「해당 단계의 퇴고 학생」, 이 배너는 「모든 단계 합계」다.
                        기준이 다른 두 숫자가 한 화면에 있으므로 여기서 명시적으로 구분한다. */}
                    퇴고 학생 전체 {revisionStudents.length}명 (모든 단계 합계) · 1차 → 2차 교사 채점 등급 비교
                  </span>
                </div>
              )}

              {gradingViewMode === 'card' ? (
              <div className="student-grid">
                {filteredStudents.map(student => {
                  const isBulkGrading = bulkGradingIds.includes(student.id);
                  return (
                  <div key={student.id} className={`student-card ${isBulkGrading ? 'is-bulk-grading' : ''}`}>
                    {isBulkGrading && (
                      <div className="card-grading-overlay" aria-live="polite">
                        <div className="card-grading-spinner" aria-hidden="true"></div>
                        <div className="card-grading-text">AI 채점중...</div>
                      </div>
                    )}
                    <input
                      type="checkbox"
                      className="card-checkbox"
                      checked={selectedIds.includes(student.id)}
                      onChange={() => toggleStudent(student.id)}
                      disabled={isBulkGrading || isAnyBgActive}
                      title={isAnyBgActive && !isBulkGrading ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                    />
                    <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                      {/* [SCR-06] 차수 배지 — 상태 배지 앞에 배치해 「몇 차 답안인지」를 먼저 읽히게 함 */}
                      {renderRoundBadge(student)}
                      {student.status === '미채점' ? (
                        student.submitType === 'ocr' ? (
                          /* [v3.24] 舊 「OCR 제출」 → 「답안 있음」. 제출 수단 무관하게 「채점 전 + 답안 존재」를 의미 */
                          <div className="card-badge" style={{ background: '#EBF2FF', color: '#2A75F3' }}>답안 있음</div>
                        ) : (
                          <div className="card-badge badge-red-soft">미채점</div>
                        )
                      ) : (
                        <div className="card-badge badge-blue-soft">{student.status}</div>
                      )}
                      {student.handwritingEvaluation && (
                        <div
                          className="card-badge"
                          style={{ background: '#F5F3FF', color: '#8B5CF6', fontWeight: 700 }}
                          title={`과정평가: ${student.handwritingEvaluation.systemDataLog?.processPattern || ''}`}
                        >
                          ✎ 과정평가 완료
                        </div>
                      )}
                    </div>
                    <div className="student-name">{student.name}</div>
                    <div className="student-meta">{student.grade}</div>
                    <div className="grading-info">
                      <div className="grading-row">
                        <span className="label">AI채점 :</span>
                        <span className="value">{student.aiGrade}</span>
                      </div>
                      <div className="grading-row">
                        <span className="label">교사채점 :</span>
                        <span className="value">
                          {student.teacherGrade !== '-' && <span className="badge-dot badge-orange"></span>}
                          {student.teacherGrade}
                        </span>
                      </div>
                      {/* [SCR-06] 1차→2차 등급 추이 · 차수별 AI 채점 잔여 횟수 */}
                      {isV2 && (student.history || []).length > 0 && (
                        <div className="grading-row" style={{ alignItems: 'center' }}>
                          <span className="label">추이 :</span>
                          <span className="value">{renderTrendChip(student)}</span>
                        </div>
                      )}
                      {isV2 && (
                        <div className="grading-row">
                          <span className="label">AI 채점 :</span>
                          <span className="value" style={{ fontSize: 'var(--neo-font-size-xs)', color: getRemainingAiCount(student) === 0 ? '#EF4444' : '#8A94A1' }}>
                            {student.round ?? 1}차 {student.aiCount?.[student.round ?? 1] ?? 0}/{AI_GRADING_LIMIT_PER_ROUND}회
                            {getRemainingAiCount(student) === 0 && ' (소진)'}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      className="btn-card-detail"
                      onClick={() => handleOpenModal(student)}
                      disabled={isBulkGrading}
                      title={isBulkGrading ? 'AI 채점이 진행 중입니다.' : undefined}
                    >
                      상세보기
                    </button>
                  </div>
                  );
                })}
              </div>
              ) : (
              <div className="student-list-table-wrapper">
                <table className="student-list-table">
                  <thead>
                    <tr>
                      <th style={{ width: '40px' }}>
                        <input
                          type="checkbox"
                          checked={filteredStudents.length > 0 && filteredStudents.every(s => selectedIds.includes(s.id))}
                          onChange={toggleAll}
                          disabled={isAnyBgActive}
                          title={isAnyBgActive ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                        />
                      </th>
                      <th>학생 이름</th>
                      <th>학년/반/번호</th>
                      {/* [SCR-06] v2 전용 — 차수 / 1차→2차 추이 */}
                      {isV2 && <th style={{ width: '72px' }}>차수</th>}
                      <th>AI 채점</th>
                      <th>교사 채점</th>
                      {isV2 && <th style={{ width: '170px' }}>퇴고 추이</th>}
                      <th>상태</th>
                      <th style={{ width: '100px' }}>상세보기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map(student => {
                      const isBulkGrading = bulkGradingIds.includes(student.id);
                      const statusBadge = (() => {
                        if (student.status === '미채점') {
                          /* [v3.24] 舊 「OCR 제출」 → 「답안 있음」 */
                          return student.submitType === 'ocr'
                            ? <span className="card-badge" style={{ background: '#EBF2FF', color: '#2A75F3' }}>답안 있음</span>
                            : <span className="card-badge badge-red-soft">미채점</span>;
                        }
                        return <span className="card-badge badge-blue-soft">{student.status}</span>;
                      })();
                      return (
                        <tr
                          key={student.id}
                          className={`student-list-row ${isBulkGrading ? 'is-bulk-grading' : ''}`}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(student.id)}
                              onChange={() => toggleStudent(student.id)}
                              disabled={isBulkGrading || isAnyBgActive}
                              title={isAnyBgActive && !isBulkGrading ? 'AI 채점이 진행 중입니다. 완료 후 다시 시도해 주세요.' : undefined}
                            />
                          </td>
                          <td className="cell-name">{student.name}</td>
                          <td className="cell-grade">{student.grade}</td>
                          {isV2 && <td>{renderRoundBadge(student)}</td>}
                          <td className="cell-ai">
                            {isBulkGrading ? (
                              <span className="grading-chip">
                                <span className="grading-chip-spinner" aria-hidden="true"></span>
                                채점중...
                              </span>
                            ) : (
                              <span className="cell-value">{student.aiGrade}</span>
                            )}
                          </td>
                          <td className="cell-teacher">
                            <span className="cell-value">{student.teacherGrade}</span>
                          </td>
                          {isV2 && (
                            <td>
                              {renderTrendChip(student) || <span style={{ color: '#CBD5E1' }}>—</span>}
                            </td>
                          )}
                          <td>{statusBadge}</td>
                          <td>
                            {isBulkGrading ? (
                              <span className="link-detail-disabled" title="AI 채점이 진행 중입니다.">
                                상세보기 &gt;
                              </span>
                            ) : (
                              <button className="link-detail" onClick={() => handleOpenModal(student)}>
                                상세보기 &gt;
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}

              {/* [v3.20] 하단 floating 일괄 액션 영역 폐기 — 모든 일괄 액션 버튼이 view-controls(상단)로 승격됨 */}
            </section>
          </div>
        </>
      ) : (
        <div style={{ padding: '3rem', textAlign: 'center' }}>
          <h2>과제 관리 화면</h2>
          <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>과제 관리 기능을 준비 중입니다.</p>
        </div>
      )}

      {/* ── 일괄 채점 워크플로우 모달 ── */}
      {isBulkModalOpen && (
        <div className="modal-overlay" onClick={() => { if (bulkStatus !== 'processing') handleCloseProcessing(); }}>
          <div className="modal-container" style={{ width: '800px', height: 'auto', minHeight: '400px', padding: '2rem' }} onClick={e => e.stopPropagation()}>
            <button className="btn-modal-close" onClick={handleCloseProcessing}>×</button>
            <h2 style={{ textAlign: 'center', fontSize: '1.5rem', marginBottom: '2rem' }}>펜 데이터 동기화</h2>

            {bulkStep === 'checking' && (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <div className="loading-spinner" style={{ margin: '0 auto 2rem' }}></div>
                <h3 style={{ fontSize: 'var(--neo-font-size-lg)', marginBottom: '0.5rem' }}>NeoStudio2Lite 설치 여부를 확인하는 중입니다.</h3>
                <p style={{ color: '#8A94A1' }}>잠시만 기다려 주세요.</p>
              </div>
            )}

            {bulkStep === 'not_installed' && (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: '4rem', color: '#FF4D4D', marginBottom: '1.5rem' }}>⚠️</div>
                <h3 style={{ fontSize: 'var(--neo-font-size-lg)', marginBottom: '0.5rem' }}>NeoStudio2Lite가 설치되어 있지 않습니다.</h3>
                <p style={{ color: '#8A94A1', marginBottom: '2rem' }}>펜 데이터 동기화를 위해 설치가 필요합니다.</p>
                <button className="btn-primary" style={{ padding: '0.8rem 2rem' }} onClick={() => setBulkStep('manual_install')}>수동 설치 안내</button>
              </div>
            )}

            {bulkStep === 'manual_install' && (
              <div style={{ padding: '0.5rem' }}>
                <p style={{ textAlign: 'center', color: '#8A94A1', fontSize: 'var(--neo-font-size-sm)', marginBottom: '2rem' }}>자동 설치가 실패한 경우 아래 방법으로 수동 설치할 수 있습니다.</p>
                <div style={{ marginBottom: '2rem' }}>
                  {[['설치 파일 다운로드', 'NeoStudio2Lite 설치 파일을 다운로드합니다.'], ['설치 파일 실행', '다운로드한 설치 파일을 실행합니다.'], ['설치 진행', '설치 마법사의 안내에 따라 설치를 진행합니다.']].map(([title, desc], i) => (
                    <div key={i} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                      <div style={{ background: '#2A75F3', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--neo-font-size-sm)', flexShrink: 0 }}>{i + 1}</div>
                      <div>
                        <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>{title}</div>
                        <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#4E5968' }}>{desc}</p>
                        {i === 0 && <button className="btn-primary" style={{ fontSize: 'var(--neo-font-size-sm)', padding: '0.6rem 1.25rem', marginTop: '0.5rem' }} onClick={() => setIsNeoStudioInstalled(true)}>NeoStudio2Lite 설치 파일 다운로드 (약 100MB)</button>}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button className="btn-card-detail" style={{ width: '200px' }} onClick={() => { setIsBulkModalOpen(false); setIsNeoStudioInstalled(true); }}>닫기</button>
                </div>
              </div>
            )}

            {bulkStep === 'instruction' && (
              <div style={{ padding: '0.5rem' }}>
                <div style={{ background: '#EFF6FF', borderRadius: '12px', padding: '1.5rem', marginBottom: '2rem' }}>
                  <h3 style={{ color: '#1D4ED8', fontSize: 'var(--neo-font-size-base)', marginBottom: '1rem' }}>💡 일괄 채점 안내</h3>
                  <ul style={{ fontSize: 'var(--neo-font-size-base)', color: '#1E293B', lineHeight: '1.8' }}>
                    <li>• 선택하신 <strong>{selectedIds.length}명</strong>의 학생에 대해 AI 채점을 일괄 시작합니다.</li>
                    <li>• NeoSmartpen의 데이터가 NeoStudio2Lite를 통해 자동으로 서버에 전송됩니다.</li>
                    <li>• 채점 도중 브라우저를 닫지 마세요.</li>
                  </ul>
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button className="btn-card-detail" style={{ flex: 1 }} onClick={() => setIsBulkModalOpen(false)}>취소</button>
                  <button className="btn-primary" style={{ flex: 2 }} onClick={() => setBulkStep('final_bulk')}>채점 시작하기</button>
                </div>
              </div>
            )}

            {bulkStep === 'final_bulk' && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ background: '#4E5968', color: 'white', padding: '1rem 1.5rem', borderRadius: '12px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>💡 크래들 이용 가이드</span><span>▼</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
                  <div style={{ fontWeight: 800, fontSize: 'var(--neo-font-size-base)', display: 'flex', gap: '1rem' }}>
                    <span>연결된 펜 <span style={{ color: '#4E5968' }}>{penData.length}개</span></span>
                    {mismatchedPenCount > 0 && <span>그룹 불일치 <span style={{ color: '#FF8C00' }}>{mismatchedPenCount}개</span></span>}
                    {bulkStatus === 'completed' && <span style={{ marginLeft: '0.5rem' }}>성공 <span style={{ color: '#10B981' }}>{penData.filter(p => p.completed).length}개</span></span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ color: '#10B981', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700 }}>● 크래들 연결됨</span>
                  </div>
                </div>

                {/* 펌웨어 업데이트 — 선택·권장 안내 (필수 아님) */}
                {bulkStatus === 'ready' && (
                  <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1rem', fontSize: 'var(--neo-font-size-sm)', color: '#1E40AF', lineHeight: 1.7 }}>
                    <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>📌 펌웨어 업데이트 (선택 · 권장)</div>
                    펜 펌웨어를 최신 버전으로 업데이트하면 펜의 최신 기능을 이용하고 펜을 더 잘 활용할 수 있습니다. 각 펜의 [🔄 업데이트](개별) 또는 하단 [펌웨어 일괄 업데이트](일괄)로 갱신할 수 있습니다. 업데이트 중에는 펜을 제거하지 마세요. 완료 후 자동으로 최신 버전으로 표시됩니다.
                    <div style={{ marginTop: '0.5rem', color: '#2563EB', fontWeight: 700 }}>ℹ️ 펌웨어 업데이트는 필수가 아니며, 업데이트하지 않아도 일괄 채점을 시작할 수 있습니다.</div>
                  </div>
                )}

                {/* ── 그룹 불일치 경고 배너 ── */}
                {mismatchedPenCount > 0 && bulkStatus === 'ready' && (
                  <div style={{
                    background: '#FFF7ED',
                    border: '1px solid #FDBA74',
                    borderRadius: '12px',
                    padding: '1.25rem 1.5rem',
                    marginBottom: '1rem',
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'flex-start'
                  }}>
                    <div style={{ fontSize: '1.5rem', flexShrink: 0, marginTop: '2px' }}>⚠️</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 'var(--neo-font-size-base)', color: '#C2410C', marginBottom: '0.5rem' }}>
                        그룹 불일치 펜이 {mismatchedPenCount}개 감지되었습니다
                      </div>
                      <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#9A3412', lineHeight: '1.7' }}>
                        번호표에 체크된 그룹과 현재 선택한 그룹이 일치하지 않는 펜이 있습니다.<br />
                        해당 펜의 번호표는 <strong>다른 반의 번호표</strong>로 체크되어 있어,<br />
                        현재 선택된 그룹의 학생과 매칭할 수 없습니다.
                      </div>
                      <div style={{
                        marginTop: '0.75rem',
                        padding: '0.75rem 1rem',
                        background: '#FEF3C7',
                        borderRadius: '8px',
                        fontSize: 'var(--neo-font-size-sm)',
                        color: '#92400E',
                        lineHeight: '1.6'
                      }}>
                        💡 <strong>해결 방법:</strong> 해당 펜의 번호표를 올바른 그룹(현재 선택: <strong>{selectedGroup || '미선택'}</strong>)으로
                        다시 체크한 후, 크래들에 다시 연결해 주세요.
                      </div>
                    </div>
                  </div>
                )}

                {/* [v4.5] 완료 요약 — SCR-05 스캔 채점 완료 단계와 같은 지표(문항 수 · 학생 수)를 노출한다 */}
                {bulkStatus === 'completed' && (
                  <div style={{ background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '12px', padding: '1rem 1.25rem', marginBottom: '1rem', textAlign: 'center' }}>
                    <div style={{ fontWeight: 800, fontSize: 'var(--neo-font-size-base)', color: '#065F46', marginBottom: '6px' }}>
                      일괄 채점이 완료되었습니다.
                    </div>
                    <div style={{ fontSize: 'var(--neo-font-size-base)', color: '#047857', marginBottom: '10px' }}>
                      채점 문항 <strong>{bulkGradedQuestionCount}건</strong> · 학생 <strong>{bulkGradedCount}명</strong>
                    </div>
                    {bulkFailedCount > 0 && (
                      <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '8px', padding: '8px 12px', maxWidth: 620, margin: '0 auto 8px', lineHeight: 1.6 }}>
                        ⚠ <strong>{bulkFailedCount}명</strong>은 채점되지 않아 <strong>미채점 탭에 그대로 남습니다.</strong> 펜 데이터를 확인한 뒤 다시 실행해 주세요.
                      </div>
                    )}
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#065F46', background: 'white', border: '1px solid #BBF7D0', borderRadius: '8px', padding: '8px 14px', display: 'inline-block' }}>
                      전 문항이 채점된 <strong>{bulkGradedCount}명</strong>이 「채점 확인」 단계로 이동했습니다.
                    </div>
                  </div>
                )}

                {/* --- 정렬 컨트롤 --- */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem', padding: '0.75rem 1rem', background: '#F8F9FA', borderRadius: '8px', border: '1px solid #E5E7EB' }}>
                  <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#4E5968' }}>학생 목록 정렬</span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {[
                      { id: 'none', label: '기본순' },
                      { id: 'name', label: '이름순' },
                      { id: 'grade', label: '학년반번호순' }
                    ].map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setPenSortBy(opt.id)}
                        style={{
                          padding: '4px 12px',
                          fontSize: 'var(--neo-font-size-xs)',
                          borderRadius: '6px',
                          border: '1px solid',
                          borderColor: penSortBy === opt.id ? '#2A75F3' : '#E5E7EB',
                          background: penSortBy === opt.id ? '#EBF2FF' : 'white',
                          color: penSortBy === opt.id ? '#2A75F3' : '#8A94A1',
                          fontWeight: 700,
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ maxHeight: '300px', overflowY: 'auto', borderTop: '1px solid #1E2225' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#F1F3F5' }}>
                        <th style={{ padding: '12px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'left', fontWeight: 800 }}>펜 ID</th>
                        <th style={{ padding: '12px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'left', fontWeight: 800 }}>학생</th>
                        <th style={{ padding: '12px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center', fontWeight: 800 }}>채점 진행</th>
                        <th style={{ padding: '12px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center', fontWeight: 800 }}>데이터</th>
                        <th style={{ padding: '12px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center', fontWeight: 800 }}>배터리</th>
                        <th style={{ padding: '12px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center', fontWeight: 800 }}>펌웨어</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPenData.map((pen, idx) => {
                        const isNoData = pen.data === '데이터 없음';
                        const isMismatch = pen.isGroupMismatch;
                        const rowColor = isMismatch ? '#C2410C' : isNoData ? '#ADB5BD' : (pen.isWarning ? '#FF4D4D' : '#4E5968');
                        const rowBg = isMismatch ? '#FFF7ED' : 'transparent';
                        return (
                          <tr key={idx} style={{ borderBottom: '1px solid #f1f3f5', opacity: isNoData ? 0.6 : 1, background: rowBg }}>
                            <td style={{ padding: '14px 1rem', fontSize: 'var(--neo-font-size-sm)', color: rowColor, fontWeight: isMismatch ? 700 : 400 }}>
                              {isMismatch && <span style={{ color: '#FF8C00', marginRight: '4px' }}>⚠</span>}
                              {pen.id}
                            </td>
                            <td style={{ padding: '14px 1rem', fontSize: 'var(--neo-font-size-sm)', color: rowColor, fontWeight: isMismatch ? 700 : 400 }}>{pen.student}</td>
                            <td style={{ padding: '14px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center' }}>
                              {pen.status === 'AI 채점중' ? (
                                <div style={{ position: 'relative', width: '220px', height: '24px', background: '#F3F4F6', borderRadius: '12px', overflow: 'hidden', margin: '0 auto' }}>
                                  <div style={{ position: 'absolute', top: 0, left: 0, width: `${pen.progress}%`, height: '100%', background: '#D1E3FF' }}></div>
                                  <span style={{ position: 'absolute', width: '100%', left: 0, top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--neo-font-size-xs)', color: '#4E5968', fontWeight: 700 }}>AI 채점중</span>
                                </div>
                              ) : isMismatch ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                  <div style={{ background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: '12px', padding: '4px 12px', fontSize: 'var(--neo-font-size-xs)', color: '#C2410C', display: 'inline-block', minWidth: '120px', fontWeight: 700 }}>
                                    ⚠️ 그룹 불일치
                                  </div>
                                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#9A3412', lineHeight: '1.4' }}>
                                    감지: <strong>{pen.detectedGroup}</strong> → 선택: <strong>{pen.expectedGroup}</strong>
                                  </div>
                                </div>
                              ) : (
                                <div style={{ background: pen.status === 'AI 채점 완료' ? '#D1E3FF' : pen.status === '채점 실패' ? '#FFF1F2' : '#F3F4F6', borderRadius: '12px', padding: '4px 0', fontSize: 'var(--neo-font-size-xs)', color: pen.status === 'AI 채점 완료' ? '#2A75F3' : pen.status === '채점 실패' ? '#FF4D4D' : '#8A94A1', display: 'inline-block', minWidth: '120px' }}>
                                  {pen.status}
                                </div>
                              )}
                            </td>
                            <td style={{ padding: '14px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center', color: isMismatch ? '#C2410C' : pen.data === '데이터 삭제' ? '#ADB5BD' : (isNoData ? '#ADB5BD' : '#2A75F3'), fontWeight: 700 }}>
                              {isMismatch ? '동기화 불가' : pen.data}
                            </td>
                            <td style={{ padding: '14px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center', color: rowColor }}>{pen.battery}</td>
                            <td style={{ padding: '14px 1rem', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                <span style={{ fontSize: 'var(--neo-font-size-sm)', color: pen.needsUpdate ? '#FF4D4D' : '#8A94A1' }}>{pen.firmware}</span>
                                {pen.needsUpdate && !pen.updating && !isNoData && (
                                  <button onClick={startFirmwareUpdate} style={{ background: '#FF4D4D', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, cursor: 'pointer' }}>업데이트</button>
                                )}
                                {pen.updating && (
                                  <div style={{ width: '60px', height: '6px', background: '#E5E7EB', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ width: `${updatePercent}%`, background: '#2A75F3', height: '100%' }}></div>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* OCR 구분선 */}
                <div style={{ display: 'flex', alignItems: 'center', margin: '1.5rem 1rem 1rem' }}>
                  <div style={{ flex: 1, height: '1px', background: '#E5E7EB' }}></div>
                  <span style={{ padding: '0 1.5rem', color: '#8A94A1', fontSize: 'var(--neo-font-size-sm)', fontWeight: 600 }}>OCR 데이터</span>
                  <div style={{ flex: 1, height: '1px', background: '#E5E7EB' }}></div>
                </div>
                <div style={{ background: '#1B222E', borderRadius: '12px', padding: '1.5rem', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 700, color: '#FFFFFF', marginBottom: '1rem' }}>OCR 데이터 {ocrData.length}개</h3>
                  {sortedOcrData.map(ocr => (
                    <div key={ocr.id} style={{ border: '1px solid #2A3441', borderRadius: '8px', padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#11161D', marginBottom: '0.75rem' }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 'var(--neo-font-size-base)', color: '#FFFFFF' }}>{ocr.name} <span style={{ fontWeight: 400 }}>{ocr.grade}</span></div>
                        <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#8E9AAB' }}>{ocr.status}</div>
                      </div>
                      <button style={{ background: '#2A75F3', border: 'none', color: '#FFFFFF', padding: '8px 20px', borderRadius: '6px', fontSize: 'var(--neo-font-size-sm)', fontWeight: 600 }}>OCR 대상</button>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1rem', borderTop: '1px solid #E5E7EB' }}>
                  {bulkStatus === 'ready' ? (
                    <>
                      <button
                        title="펌웨어 업데이트는 채점의 필수 요건은 아닙니다."
                        style={{ background: '#EBF2FF', color: '#2A75F3', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        ↺ 펌웨어 일괄 업데이트 <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 400, opacity: 0.7 }}>(선택)</span>
                      </button>
                      <button
                        className={mismatchedPenCount > 0 ? '' : 'btn-primary'}
                        style={mismatchedPenCount > 0 ? {
                          padding: '0.8rem 4rem',
                          background: '#FF8C00',
                          color: 'white',
                          border: 'none',
                          borderRadius: '10px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        } : {
                          padding: '0.8rem 4rem'
                        }}
                        onClick={() => {
                          if (mismatchedPenCount > 0) {
                            // 그룹 불일치 펜을 목록에서 삭제 (프로토타입 동작)
                            removeMismatchedPens();
                            return;
                          }
                          startGrading();
                        }}
                      >
                        {mismatchedPenCount > 0 ? '⚠️ 그룹 불일치 확인 필요' : '일괄 채점 시작'}
                      </button>
                    </>
                  ) : (
                    <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
                      <button className="btn-card-detail" style={{ padding: '0.8rem 4rem' }} onClick={handleCloseProcessing}>닫기</button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── SCR-02: 미채점 상세 모달 ── */}
      <UngradedDetailModal
        isOpen={isModalOpen && selectedStudent?.status === '미채점'}
        onClose={() => setIsModalOpen(false)}
        selectedStudent={selectedStudent}
        onSelectStudent={setSelectedStudent}
        students={roster.filter(s => s.status === '미채점')}
        questions={questions}
        activeQuestion={activeQuestion}
        setActiveQuestion={setActiveQuestion}
        isScanUploadOpen={isScanUploadOpen}
        setIsScanUploadOpen={setIsScanUploadOpen}
        bgGradingActive={(!!bgIndividual && bgIndividual.studentId !== selectedStudent?.id) || showFAB}
        onStartGrading={(student) => {
          // AI 채점 시작 시 상태 전환 (시뮬레이션)
          setTimeout(() => {
            setStudents(prev => prev.map(s => s.id === student.id ? { ...s, status: '채점 확인', aiGrade: '노력' } : s));
            setSelectedStudent(prev => prev && prev.id === student.id ? { ...prev, status: '채점 확인', aiGrade: '노력' } : prev);
            // 백그라운드 진행 중이면 완료 표시 (FAB이 ✓로 전환됨)
            setBgIndividual(prev => (prev && prev.studentId === student.id) ? { ...prev, isFinished: true } : prev);
          }, 3000);
        }}
        onBackgroundGrading={(student) => {
          // [백그라운드 진행] 선택: 모달 닫고 FAB 활성화
          setBgIndividual({ studentId: student.id, studentName: student.name, isFinished: false });
          setIsModalOpen(false);
        }}
      />

      {/* ── SCR-03: 채점 확인 상세 모달 ── */}
      <GradingReviewModal
        isOpen={isModalOpen && (selectedStudent?.status === '채점 확인' || selectedStudent?.status === '결과 발송 완료')}
        onClose={() => setIsModalOpen(false)}
        selectedStudent={selectedStudent}
        onSelectStudent={setSelectedStudent}
        students={roster.filter(s => s.status === '채점 확인' || s.status === '결과 발송 전' || s.status === '결과 발송 완료')}
        questions={questions}
        taskSubject={currentTask.type}
        activeQuestion={activeQuestion}
        setActiveQuestion={setActiveQuestion}
        gradingHistory={gradingHistory}
        reflectedHistoryId={reflectedHistoryId}
        setReflectedHistoryId={setReflectedHistoryId}
        teacherFinalFeedback={teacherFinalFeedback}
        setTeacherFinalFeedback={setTeacherFinalFeedback}
        onReviewComplete={(student) => {
          setIsModalOpen(false);
          setStudents(prev => prev.map(s => s.id === student.id ? { ...s, ...student, status: '결과 발송 전' } : s));
        }}
        onResultSend={(student) => {
          setStudents(prev => prev.map(s => s.id === student.id ? { ...s, status: '결과 발송 완료' } : s));
          alert(`${student.name} 학생에게 결과가 발송되었습니다.`);
        }}
        onResultSendCancel={(student) => {
          setStudents(prev => prev.map(s => s.id === student.id ? { ...s, status: '결과 발송 전' } : s));
        }}
        onRevertToStep2={(student) => {
          setStudents(prev => prev.map(s => s.id === student.id ? { ...s, status: '채점 확인' } : s));
          setIsModalOpen(false);
        }}
        onRevertToUngraded={(student) => {
          // [SCR-03 → SCR-01] 미채점 단계 복귀: 채점 결과·피드백 폐기, 미채점 탭으로 자동 이동
          setStudents(prev => prev.map(s =>
            s.id === student.id
              ? { ...s, status: '미채점', aiGrade: '-', teacherGrade: '-' }
              : s
          ));
          setIsModalOpen(false);
          setActiveTab('미채점');
        }}
        onHandwritingEvaluated={handleHandwritingEvaluated}
        /* [SCR-06] 상세에서 바로 퇴고 요청 — v2에서만 노출 */
        isV2={isV2}
        aiGradingLimitPerRound={AI_GRADING_LIMIT_PER_ROUND}
        onRevisionRequest={isV2 ? handleRevisionRequestFromDetail : undefined}
      />

      {/* ── 채점 결과 내보내기 모달 ── */}
      {isExportModalOpen && (() => {
        const eligibleList = roster.filter(s => s.status === '결과 발송 전' || s.status === '결과 발송 완료');
        const allSelected = exportSelectedIds.length === eligibleList.length && eligibleList.length > 0;
        const toggleOne = (id) => setExportSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
        const toggleAll = () => setExportSelectedIds(allSelected ? [] : eligibleList.map(s => s.id));
        const closeModal = () => { if (exportStatus !== 'processing') { setIsExportModalOpen(false); setPreviewStudent(null); } };
        const toggleContentOption = (key) => {
          if (key === 'feedback') return; // 교사 피드백은 고정
          setExportContentOptions(prev => ({ ...prev, [key]: !prev[key] }));
        };
        const includedSectionLabels = [
          exportContentOptions.question && '문항',
          exportContentOptions.answer && '답안',
          exportContentOptions.feedback && '교사 피드백'
        ].filter(Boolean);
        const startExport = () => {
          if (exportSelectedIds.length === 0) return;
          setExportStatus('processing');
          setExportProgress(0);
          const total = exportSelectedIds.length;
          // [v2.2] 엑셀은 단일 파일이므로 진행 단계 단순화 (3-step 시뮬레이션), PDF는 학생별 tick 유지
          if (exportFormat === 'excel') {
            let stepProgress = 0;
            const tick = () => {
              stepProgress += 33;
              setExportProgress(Math.min(stepProgress, 100));
              if (stepProgress < 100) {
                setTimeout(tick, 400);
              } else {
                setExportStatus('done');
                setTimeout(() => {
                  alert(`${total}명 명단이 엑셀로 다운로드되었습니다.\n파일명: ${currentTask.title}.xlsx\n열: 이름 · 학년반번호 · 등급 · 피드백`);
                  setIsExportModalOpen(false);
                  setExportStatus('ready');
                  setExportProgress(0);
                }, 400);
              }
            };
            setTimeout(tick, 400);
            return;
          }
          // PDF (ZIP 묶음) — 기존 학생별 tick
          let current = 0;
          const tick = () => {
            current += 1;
            setExportProgress(Math.round((current / total) * 100));
            if (current < total) {
              setTimeout(tick, 350);
            } else {
              setExportStatus('done');
              setTimeout(() => {
                alert(`${total}건의 리포트가 ZIP 파일로 다운로드되었습니다.\n파일명: ${currentTask.title}_채점결과_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.zip\n포함 항목: ${includedSectionLabels.join(' / ')}`);
                setIsExportModalOpen(false);
                setExportStatus('ready');
                setExportProgress(0);
              }, 400);
            }
          };
          setTimeout(tick, 350);
        };

        return (
          <div className="modal-overlay" onClick={closeModal}>
            <div className="modal-container" style={{ width: '720px', maxHeight: '85vh', padding: '2rem', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
              {exportStatus !== 'processing' && <button className="btn-modal-close" onClick={closeModal}>×</button>}
              <h2 style={{ fontSize: 'var(--neo-font-size-xl)', fontWeight: 800, color: '#1E2225', marginBottom: '0.5rem' }}>📤 채점 결과 내보내기</h2>
              <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginBottom: '1rem' }}>
                결과 발송 단계의 학생 리포트를 <strong>PDF(학생별 개별, ZIP 묶음)</strong> 또는 <strong>엑셀(전체 명단 1파일)</strong>로 내보냅니다. 과정평가 완료 학생은 PDF에 과정평가 내용이 포함됩니다.
              </p>

              {/* [v2.2] 출력 형식 라디오 — 형식 선택에 따라 옵션 영역 동적 분기 */}
              {exportStatus === 'ready' && (
                <div style={{ display: 'flex', gap: '24px', alignItems: 'center', padding: '12px 14px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '8px', marginBottom: '0.75rem', fontSize: 'var(--neo-font-size-sm)' }}>
                  <span style={{ fontWeight: 700, color: '#1E2225' }}>📋 출력 형식</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#1E2225', fontWeight: exportFormat === 'pdf' ? 700 : 500 }}>
                    <input type="radio" name="exportFormat" checked={exportFormat === 'pdf'} onChange={() => setExportFormat('pdf')} />
                    📄 PDF <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', fontWeight: 500 }}>(학생별 개별 리포트 · ZIP 묶음)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#1E2225', fontWeight: exportFormat === 'excel' ? 700 : 500 }}>
                    <input type="radio" name="exportFormat" checked={exportFormat === 'excel'} onChange={() => setExportFormat('excel')} />
                    📊 엑셀 <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', fontWeight: 500 }}>(전체 명단 1파일)</span>
                  </label>
                </div>
              )}

              {/* [v2.2] PDF 선택 시 — 기존 포함 항목 체크박스 */}
              {exportStatus === 'ready' && exportFormat === 'pdf' && (
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', padding: '10px 14px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: '8px', marginBottom: '1rem', fontSize: 'var(--neo-font-size-sm)' }}>
                  <span style={{ fontWeight: 700, color: '#1E2225' }}>📋 PDF 포함 항목</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#334155' }}>
                    <input type="checkbox" checked={exportContentOptions.question} onChange={() => toggleContentOption('question')} />
                    문항
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: '#334155' }}>
                    <input type="checkbox" checked={exportContentOptions.answer} onChange={() => toggleContentOption('answer')} />
                    답안
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'not-allowed', color: '#64748B' }} title="교사 피드백은 항상 포함됩니다.">
                    <input type="checkbox" checked disabled />
                    교사 피드백 <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>(고정)</span>
                  </label>
                </div>
              )}

              {/* [v2.2] 엑셀 선택 시 — 고정 열 안내 박스 */}
              {exportStatus === 'ready' && exportFormat === 'excel' && (
                <div style={{ padding: '12px 14px', background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: '8px', marginBottom: '1rem', fontSize: 'var(--neo-font-size-sm)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, color: '#1E2225' }}>📊 엑셀 열 구성 — 고정</span>
                    <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>이름 · 학년반번호 · 등급 · 피드백 (4열)</span>
                  </div>
                  <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', lineHeight: 1.5 }}>
                    파일명: <strong style={{ color: '#1E2225' }}>{`${currentTask?.title || '과제명'}.xlsx`}</strong> · 학생별 1행. 엑셀은 <strong>문항·답안 미포함</strong>이며 미리보기를 지원하지 않습니다.
                    <br />
                    💡 문항·답안을 포함하려면 출력 형식을 <strong style={{ color: '#1D4ED8' }}>[📄 PDF]</strong>로 변경하세요.
                  </div>
                </div>
              )}

              {exportStatus === 'ready' && (
                <>
                  <div style={{ flex: 1, overflow: 'auto', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--neo-font-size-sm)' }}>
                      <thead style={{ background: '#F9FAFB', position: 'sticky', top: 0 }}>
                        <tr>
                          <th style={{ padding: '10px 12px', textAlign: 'left', width: '40px' }}>
                            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                          </th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', width: '50px' }}>번호</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left' }}>이름</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left' }}>학년/반/번호</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left' }}>상태</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left' }}>과정평가</th>
                          <th style={{ padding: '10px 12px', textAlign: 'left', width: '70px' }}>미리보기</th>
                        </tr>
                      </thead>
                      <tbody>
                        {eligibleList.map((s, idx) => (
                          <tr key={s.id} style={{ borderTop: '1px solid #F3F4F6' }}>
                            <td style={{ padding: '10px 12px' }}>
                              <input type="checkbox" checked={exportSelectedIds.includes(s.id)} onChange={() => toggleOne(s.id)} />
                            </td>
                            <td style={{ padding: '10px 12px', color: '#94A3B8' }}>{idx + 1}</td>
                            <td style={{ padding: '10px 12px', fontWeight: 700 }}>{s.name}</td>
                            <td style={{ padding: '10px 12px', color: '#4E5968' }}>{s.grade}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: s.status === '결과 발송 완료' ? '#D1FAE5' : '#FEF3C7', color: s.status === '결과 발송 완료' ? '#065F46' : '#92400E' }}>
                                {s.status}
                              </span>
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              {s.handwritingEvaluation ? (
                                <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, padding: '2px 8px', borderRadius: '4px', background: '#F3E8FF', color: '#86198F' }}>✎ 완료</span>
                              ) : (
                                <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>-</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <button
                                onClick={() => exportFormat === 'pdf' && setPreviewStudent(s)}
                                disabled={exportFormat === 'excel'}
                                title={exportFormat === 'excel' ? '엑셀은 미리보기를 지원하지 않습니다.' : 'PDF 미리보기를 엽니다.'}
                                style={{ fontSize: 'var(--neo-font-size-xs)', padding: '3px 8px', border: '1px solid #CBD5E1', borderRadius: '4px', background: exportFormat === 'excel' ? '#F1F5F9' : 'white', cursor: exportFormat === 'excel' ? 'not-allowed' : 'pointer', color: exportFormat === 'excel' ? '#94A3B8' : '#475569' }}
                              >
                                보기
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>
                      선택: <strong style={{ color: '#2A75F3' }}>{exportSelectedIds.length}</strong>명 / 전체 {eligibleList.length}명
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={closeModal} style={{ padding: '10px 20px', border: '1px solid #E5E7EB', borderRadius: '8px', background: 'white', cursor: 'pointer', fontWeight: 700, color: '#475569' }}>
                        닫기
                      </button>
                      <button
                        disabled={exportSelectedIds.length === 0}
                        onClick={startExport}
                        style={{ padding: '10px 20px', border: 'none', borderRadius: '8px', background: exportSelectedIds.length > 0 ? '#2A75F3' : '#CBD5E1', color: 'white', cursor: exportSelectedIds.length > 0 ? 'pointer' : 'not-allowed', fontWeight: 800 }}
                      >
                        📤 내보내기 ({exportSelectedIds.length}명)
                      </button>
                    </div>
                  </div>
                </>
              )}

              {exportStatus === 'processing' && (
                <div style={{ padding: '2rem 0', textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>{exportFormat === 'excel' ? '📊' : '📦'}</div>
                  <div style={{ fontWeight: 700, marginBottom: '1rem' }}>{exportFormat === 'excel' ? '엑셀 생성 중...' : '리포트 생성 중...'}</div>
                  <div style={{ background: '#F3F4F6', borderRadius: '12px', height: '24px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                    <div style={{ width: `${exportProgress}%`, height: '100%', background: 'linear-gradient(90deg, #2A75F3, #8B5CF6)', transition: 'width 0.3s', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--neo-font-size-sm)', fontWeight: 800 }}>
                      {exportProgress > 10 && `${exportProgress}%`}
                    </div>
                  </div>
                  <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>
                    {Math.round((exportProgress / 100) * exportSelectedIds.length)}/{exportSelectedIds.length} 리포트 생성 중
                  </div>
                </div>
              )}
            </div>

            {/* [v2.4] 리포트 미리보기 팝업 — 페이지 구조 분리
                 페이지 1: 타이틀 + 문항별 성취도 + 문항 내용[조건부] + 등급평가 + 과정평가[조건부]
                 페이지 2~N: 타이틀 + 학생 답안 (답안 1개당 1페이지, 맨 뒤)
                 화면: 단일 스크롤 + 점선 구분선 + 페이지 배지
                 출력: @media print로 A4 강제 분할 */}
            {previewStudent && (() => {
              // 타이틀 영역 (모든 페이지 상단 반복) — 컴포넌트화
              const TitleArea = () => (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '8px', padding: '14px 18px', marginBottom: '20px' }}>
                  <h2 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, textAlign: 'center', margin: '0 0 12px', color: '#1E293B' }}>채점 결과 리포트</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: 'var(--neo-font-size-sm)', marginBottom: '8px' }}>
                    <div><div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>학교명</div><div style={{ color: '#1E293B', fontWeight: 700, marginTop: '2px' }}>네오중학교</div></div>
                    <div><div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>학년반번호</div><div style={{ color: '#1E293B', fontWeight: 700, marginTop: '2px' }}>{previewStudent.grade}</div></div>
                    <div><div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>학생이름</div><div style={{ color: '#1E293B', fontWeight: 700, marginTop: '2px' }}>{previewStudent.name}</div></div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', fontSize: 'var(--neo-font-size-sm)' }}>
                    <div><div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>과제명</div><div style={{ color: '#1E293B', fontWeight: 700, marginTop: '2px' }}>도형과 측정</div></div>
                    <div><div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>교과</div><div style={{ color: '#1E293B', fontWeight: 700, marginTop: '2px' }}>수학</div></div>
                    <div><div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>출제일자</div><div style={{ color: '#1E293B', fontWeight: 700, marginTop: '2px' }}>2026년 4월 13일</div></div>
                  </div>
                </div>
              );
              // 페이지 구분선 (화면 전용, 출력 시 숨김)
              const PageDivider = ({ label }) => (
                <div className="preview-page-divider" style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 32px', background: '#F1F5F9', borderTop: '1px dashed #CBD5E1', borderBottom: '1px dashed #CBD5E1' }}>
                  <hr style={{ flex: 1, border: 0, borderTop: '1px dashed #CBD5E1', margin: 0 }} />
                  <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#1D4ED8', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '4px 12px', borderRadius: '999px', whiteSpace: 'nowrap' }}>{label}</span>
                  <hr style={{ flex: 1, border: 0, borderTop: '1px dashed #CBD5E1', margin: 0 }} />
                </div>
              );
              // mock 답안 데이터 (실제로는 questions 배열 순회. prototype은 1번 문항만 노출)
              const mockAnswers = [
                {
                  no: 1,
                  text: '정삼각형의 한 내각: 60°\n정육각형의 한 내각: 120°\n정십이각형의 한 내각: 150°\n\n남은 270°를 만들 수 있는 조합:\n① 150° + 60° + 60° = 270°  → 정십이각형 1개 + 정삼각형 2개\n② 150° + 120° = 270°  → 정십이각형 1개 + 정육각형 1개\n\n따라서 가능한 조합은 두 가지이다.',
                },
              ];
              return (
                <div className="modal-overlay" onClick={() => setPreviewStudent(null)} style={{ zIndex: 10001 }}>
                  <div className="modal-container preview-popup-v24" style={{ width: '860px', maxHeight: '90vh', padding: 0, overflow: 'auto' }} onClick={e => e.stopPropagation()}>
                    {/* 인쇄용 CSS — @media print로 A4 강제 분할 */}
                    <style>{`
                      @media print {
                        .preview-page-divider { display: none !important; }
                        .preview-page { page-break-inside: avoid; padding: 20mm !important; }
                        .preview-page-answer { page-break-before: always; }
                      }
                    `}</style>
                    <button className="btn-modal-close" onClick={() => setPreviewStudent(null)} style={{ position: 'absolute', top: '12px', right: '12px', zIndex: 1 }}>×</button>

                    {/* ============ Page 1 — 본문 ============ */}
                    <section className="preview-page" style={{ padding: '24px 32px 28px', background: 'white' }}>
                      <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#94A3B8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>— Page 1 — 본문</div>
                      <TitleArea />

                      {/* 1. 문항별 성취도 */}
                      <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#2A75F3', marginTop: '1.5rem', marginBottom: '0.75rem' }}>◆ 문항별 성취도</h3>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--neo-font-size-sm)', border: '1px solid #E5E7EB' }}>
                        <thead style={{ background: '#F9FAFB' }}>
                          <tr>
                            <th style={{ padding: '10px 12px', textAlign: 'left', border: '1px solid #E5E7EB' }}>문항번호</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', border: '1px solid #E5E7EB' }}>배점</th>
                            <th style={{ padding: '10px 12px', textAlign: 'left', border: '1px solid #E5E7EB' }}>등급</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td style={{ padding: '10px 12px', border: '1px solid #E5E7EB' }}>1</td>
                            <td style={{ padding: '10px 12px', border: '1px solid #E5E7EB' }}>3</td>
                            <td style={{ padding: '10px 12px', border: '1px solid #E5E7EB' }}>{previewStudent.teacherGrade || '우수'} / 4단계 척도</td>
                          </tr>
                        </tbody>
                      </table>

                      {/* 2. 문항 내용 [조건부] */}
                      {exportContentOptions.question && (
                        <>
                          <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#2A75F3', marginTop: '1.5rem', marginBottom: '0.75rem' }}>◆ 문항 내용</h3>
                          <div style={{ fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', marginBottom: '0.5rem' }}>1번 문항</div>
                          <div style={{ background: '#F9FAFB', padding: '1rem', borderRadius: '8px', fontSize: 'var(--neo-font-size-sm)', lineHeight: 1.7, color: '#334155', border: '1px solid #E5E7EB' }}>
                            세 종류의 정다각형(정삼각형·정육각형·정십이각형)을 사용하여 한 점에서 만나는 각의 합이 360°가 되도록 평면을 채우려고 한다. 한 점에서 90°가 이미 채워져 있다고 할 때, 남은 270°를 만들 수 있는 정다각형의 조합을 모두 찾고 그 이유를 서술하시오.
                          </div>
                        </>
                      )}

                      {/* 3. 등급평가 — 항상 노출 (舊 교사 피드백) */}
                      <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#2A75F3', marginTop: '1.5rem', marginBottom: '0.75rem' }}>◆ 등급평가 <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>(항상 노출, 문항별)</span></h3>
                      <div style={{ fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', marginBottom: '0.5rem' }}>1번 문항</div>
                      <div style={{ background: '#F9FAFB', padding: '1rem', borderRadius: '8px', fontSize: 'var(--neo-font-size-sm)', lineHeight: 1.7, color: '#334155' }}>
                        <div style={{ fontWeight: 700, color: '#10B981', marginBottom: '0.25rem' }}>이런 점이 좋아요</div>
                        <div style={{ marginBottom: '0.75rem' }}>정삼각형(60°), 정육각형(120°), 정십이각형(150°)의 한 내각의 크기를 정확히 구하고, 남은 각 270°를 채우는 두 가지 조합을 완벽하게 찾아냈어요. 논리적인 설명이 매우 훌륭합니다!</div>
                        <div style={{ fontWeight: 700, color: '#F59E0B', marginBottom: '0.25rem' }}>조금만 더 노력해볼까요</div>
                        <div style={{ marginBottom: '0.75rem' }}>제시된 조건에 따라 모든 가능한 경우의 수를 빠짐없이 서술하였으므로 추가적인 보완점은 보이지 않습니다. 완벽한 답변이에요.</div>
                        <div style={{ fontWeight: 700, color: '#2A75F3', marginBottom: '0.25rem' }}>함께 성장해요</div>
                        <div style={{ marginBottom: '0.75rem' }}>앞으로도 이처럼 각 도형의 내각의 합과 한 내각의 크기 공식을 활용하여 평면을 채우는 테셀레이션 원리를 탐구해본다면 수학적 사고력이 더욱 깊어질 거예요.</div>
                        <div style={{ fontWeight: 700, color: '#8B5CF6', marginBottom: '0.25rem' }}>내용 분석</div>
                        <div>정삼각형, 정육각형, 정십이각형의 한 내각의 크기 / 270°를 구성할 수 있는 조합 찾기: <strong>매우 우수(A)</strong> — 학생은 정삼각형, 정육각형, 정십이각형의 한 내각의 크기를 정확히 명시하였으며, 이를 조합하여 270°를 만드는 두 가지 방법(150°+ 60°+ 60°, 150°+ 120°)을 모두 정확하게 찾아내고 그 이유를 논리적으로 설명하였습니다.</div>
                      </div>

                      {/* 4. 과정평가 [조건부, 과정평가 완료 학생만] */}
                      {previewStudent.handwritingEvaluation && (
                        <>
                          <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#8B5CF6', marginTop: '1.5rem', marginBottom: '0.75rem' }}>◆ 과정평가</h3>
                          <div style={{ background: '#F5F3FF', padding: '1rem', borderRadius: '8px', fontSize: 'var(--neo-font-size-sm)', lineHeight: 1.7, color: '#334155', border: '1px solid #E9D5FF' }}>
                            <div style={{ fontWeight: 700, color: '#86198F', marginBottom: '0.25rem' }}>진단된 학습 행동 패턴</div>
                            <div style={{ marginBottom: '0.75rem' }}>{previewStudent.handwritingEvaluation.systemDataLog?.processPattern || '신중한 재구조화형'}</div>
                            <div style={{ fontWeight: 700, color: '#86198F', marginBottom: '0.25rem' }}>등급 매핑 총평</div>
                            <div style={{ marginBottom: '0.75rem' }}>{previewStudent.handwritingEvaluation.evaluationSummary?.totalEvaluation || '-'}</div>
                            <div style={{ fontWeight: 700, color: '#10B981', marginBottom: '0.25rem' }}>학생의 강점</div>
                            <div style={{ marginBottom: '0.75rem' }}>{previewStudent.handwritingEvaluation.finalFeedback?.whatsGood || '-'}</div>
                            <div style={{ fontWeight: 700, color: '#F59E0B', marginBottom: '0.25rem' }}>개선 필요 지점</div>
                            <div style={{ marginBottom: '0.75rem' }}>{previewStudent.handwritingEvaluation.finalFeedback?.whatNeedsWork || '-'}</div>
                            <div style={{ fontWeight: 700, color: '#2A75F3', marginBottom: '0.25rem' }}>성장 방향 제안</div>
                            <div style={{ marginBottom: '0.75rem' }}>{previewStudent.handwritingEvaluation.finalFeedback?.letsGrowTogether || '-'}</div>
                            <div style={{ fontWeight: 700, color: '#8B5CF6', marginBottom: '0.25rem' }}>행동 지표 분석 및 병목 구간</div>
                            <div>{previewStudent.handwritingEvaluation.finalFeedback?.contentBottleneckAnalysis || '-'}</div>
                          </div>
                        </>
                      )}
                    </section>

                    {/* ============ Page 2~N — 학생 답안 (맨 뒤, 답안별 1페이지) ============ */}
                    {exportContentOptions.answer && mockAnswers.map((a, idx) => (
                      <React.Fragment key={a.no}>
                        <PageDivider label={`— Page ${idx + 2} —`} />
                        <section className="preview-page preview-page-answer" style={{ padding: '24px 32px 28px', background: 'white' }}>
                          <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#94A3B8', letterSpacing: '1px', textTransform: 'uppercase', marginBottom: '8px' }}>— Page {idx + 2} — 학생 답안 ({a.no}번 문항)</div>
                          <TitleArea />
                          <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#2A75F3', marginTop: '0.5rem', marginBottom: '0.75rem' }}>◆ 학생 답안 — {a.no}번 문항</h3>
                          <div style={{ background: '#F9FAFB', padding: '1rem', borderRadius: '8px', fontSize: 'var(--neo-font-size-sm)', lineHeight: 1.7, color: '#334155', border: '1px solid #E5E7EB', whiteSpace: 'pre-line' }}>
                            {a.text}
                            <div style={{ marginTop: '0.75rem', fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>※ 실제 PDF에는 펜 캡처 원본 이미지 또는 OCR 텍스트가 함께 첨부됩니다.</div>
                          </div>
                        </section>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ── 일괄 과정평가 모달 ── */}
      {isBulkHwModalOpen && (
        <div className="modal-overlay" onClick={() => bulkHwStatus === 'completed' && setIsBulkHwModalOpen(false)}>
          <div
            className="modal-container"
            style={{ width: bulkHwStatus === 'completed' ? '720px' : '560px', height: 'auto', padding: '2.5rem', maxHeight: '85vh', overflow: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {bulkHwStatus === 'completed' && (
              <button className="btn-modal-close" onClick={() => setIsBulkHwModalOpen(false)}>×</button>
            )}
            <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>✎</div>
              <h2 style={{ fontSize: 'var(--neo-font-size-xl)', fontWeight: 800, color: '#1E2225' }}>
                {bulkHwStatus === 'processing' ? '일괄 과정평가 진행 중' : '일괄 과정평가 결과'}
              </h2>
            </div>

            {bulkHwStatus === 'processing' && (
              <div>
                <div style={{ background: '#F3F4F6', borderRadius: '12px', height: '24px', overflow: 'hidden', marginBottom: '0.75rem' }}>
                  <div
                    style={{
                      width: `${bulkHwProgress}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #8B5CF6, #A78BFA)',
                      transition: 'width 0.3s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontSize: 'var(--neo-font-size-sm)',
                      fontWeight: 700
                    }}
                  >
                    {bulkHwProgress > 10 && `${bulkHwProgress}%`}
                  </div>
                </div>
                <p style={{ textAlign: 'center', color: '#8A94A1', fontSize: 'var(--neo-font-size-sm)' }}>
                  AI가 {bulkHwEligibleIds.length}명의 풀이 과정을 분석하고 있습니다...
                </p>
                <p style={{ textAlign: 'center', color: '#FF8C00', fontSize: 'var(--neo-font-size-xs)', marginTop: '0.5rem' }}>
                  ⚠ 진행 중 페이지를 벗어나지 마세요.
                </p>
              </div>
            )}

            {bulkHwStatus === 'completed' && (
              <div>
                {/* 요약 카드 */}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '1.5rem' }}>
                  <div style={{ flex: 1, background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#16A34A', fontWeight: 700, marginBottom: '0.25rem' }}>성공</div>
                    <div style={{ fontSize: 'var(--neo-font-size-xxl)', fontWeight: 800, color: '#16A34A' }}>{bulkHwResults.success.length}명</div>
                  </div>
                  <div style={{ flex: 1, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#DC2626', fontWeight: 700, marginBottom: '0.25rem' }}>실패</div>
                    <div style={{ fontSize: 'var(--neo-font-size-xxl)', fontWeight: 800, color: '#DC2626' }}>{bulkHwResults.failed.length}명</div>
                  </div>
                </div>

                {/* 성공 학생 결과 테이블 */}
                {bulkHwResults.success.length > 0 && (
                  <div style={{ marginBottom: '1rem', border: '1px solid #E5E7EB', borderRadius: '10px', overflow: 'hidden' }}>
                    <div style={{ padding: '0.75rem 1rem', background: '#F5F3FF', fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#6D28D9', borderBottom: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between' }}>
                      <span>✎ 과정평가 완료 학생</span>
                      <span style={{ fontWeight: 400, color: '#8A94A1' }}>클릭 시 상세보기</span>
                    </div>
                    <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ background: '#FAFBFC', fontSize: 'var(--neo-font-size-xs)', color: '#8A94A1' }}>
                            <th style={{ padding: '0.5rem 1rem', textAlign: 'left', fontWeight: 700 }}>학생</th>
                            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700 }}>학년반번</th>
                            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 700 }}>진단 패턴</th>
                            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'center', fontWeight: 700 }}>등급</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bulkHwResults.success.map(id => {
                            const st = students.find(s => s.id === id);
                            if (!st) return null;
                            const hw = st.handwritingEvaluation;
                            return (
                              <tr
                                key={id}
                                style={{ borderTop: '1px solid #F3F4F6', cursor: 'pointer', transition: 'background 0.15s' }}
                                onClick={() => {
                                  setIsBulkHwModalOpen(false);
                                  setSelectedStudent(st);
                                  setIsModalOpen(true);
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = '#F5F3FF'}
                                onMouseLeave={e => e.currentTarget.style.background = 'white'}
                              >
                                <td style={{ padding: '0.6rem 1rem', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1E2225' }}>
                                  {st.name}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: 'var(--neo-font-size-sm)', color: '#8A94A1' }}>
                                  {st.grade}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', fontSize: 'var(--neo-font-size-sm)', color: '#4E5968' }}>
                                  {hw?.evaluationSummary?.diagnosedPattern || '-'}
                                </td>
                                <td style={{ padding: '0.6rem 0.75rem', textAlign: 'center' }}>
                                  <span style={{
                                    padding: '2px 10px', borderRadius: '100px', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800,
                                    background: hw?.systemDataLog?.gradeLevel?.includes('Excellent') ? '#ECFDF5'
                                      : hw?.systemDataLog?.gradeLevel?.includes('Good') ? '#EFF6FF'
                                        : '#FFFBEB',
                                    color: hw?.systemDataLog?.gradeLevel?.includes('Excellent') ? '#059669'
                                      : hw?.systemDataLog?.gradeLevel?.includes('Good') ? '#2563EB'
                                        : '#B45309'
                                  }}>
                                    {hw?.systemDataLog?.gradeLevel || '-'}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 실패 학생 목록 */}
                {bulkHwResults.failed.length > 0 && (
                  <div style={{ marginBottom: '1rem', maxHeight: '160px', overflowY: 'auto', border: '1px solid #F3F4F6', borderRadius: '8px' }}>
                    <div style={{ padding: '0.75rem 1rem', background: '#FEF2F2', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#DC2626', borderBottom: '1px solid #F3F4F6' }}>
                      실패 학생 목록
                    </div>
                    {bulkHwResults.failed.map((f, idx) => (
                      <div key={idx} style={{ padding: '0.75rem 1rem', fontSize: 'var(--neo-font-size-sm)', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #F3F4F6' }}>
                        <span style={{ fontWeight: 700, color: '#1E2225' }}>{f.name}</span>
                        <span style={{ color: '#DC2626' }}>{f.reason}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {bulkHwResults.failed.length > 0 && (
                    <button
                      className="btn-card-detail"
                      style={{ flex: 1, padding: '0.8rem' }}
                      onClick={() => {
                        setSelectedIds(bulkHwResults.failed.map(f => f.id));
                        setIsBulkHwModalOpen(false);
                      }}
                    >
                      실패자 재시도
                    </button>
                  )}
                  <button
                    className="btn-primary"
                    style={{ flex: 1, padding: '0.8rem' }}
                    onClick={() => {
                      setIsBulkHwModalOpen(false);
                      setSelectedIds([]);
                    }}
                  >
                    닫기
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 채점 종료 확인 모달 ── */}
      {isConfirmCloseOpen && (
        <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setIsConfirmCloseOpen(false)}>
          <div className="modal-container" style={{ width: '480px', height: 'auto', padding: '2.5rem', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <p style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 700, color: '#1E2225', lineHeight: '1.6', marginBottom: '2rem' }}>
              페이지를 벗어나도 AI 채점은 멈추지 않습니다.<br />
              20분 이내로 채점이 완료 예정입니다.
            </p>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <button className="btn-card-detail" style={{ flex: 1, padding: '1rem', background: '#D1E3FF', color: '#1E2225', border: 'none' }} onClick={() => setIsConfirmCloseOpen(false)}>계속 채점하기</button>
              <button className="btn-primary" style={{ flex: 1, padding: '1rem', background: '#EF4444' }} onClick={proceedToBackground}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* [v3.16] 스캔 일괄 채점 모달 — OCR 학생 번호 연결 + AI 채점 (완료 시 handleScanCompleted → 기존 FAB 흐름 재사용) */}
      {isScanModalOpen && (
        <ScanGradingModal
          open={!scanMinimized}
          onClose={() => { setIsScanModalOpen(false); setScanMinimized(false); }}
          onMinimize={handleScanMinimize}
          onGradingFinished={() => setIsGradingFinished(true)}
          selectedStudents={students.filter((s) => selectedIds.includes(s.id))}
          groupLabel={selectedGroup || '그룹'}
          taskTitle={currentTask?.title || '과제'}
          questions={questions}
          taskCode={currentTask?.code || '00000594'}
          onCompleted={handleScanCompleted}
        />
      )}

      {/* ── [SCR-06] 퇴고 요청 확인 모달 ── */}
      {isV2 && isRevisionRequestOpen && (() => {
        const targets = students.filter(s => bulkRevisionRequestIds.includes(s.id));
        return (
          <div
            className="modal-overlay"
            onClick={() => setIsRevisionRequestOpen(false)}
            style={{ zIndex: 10000 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'white', borderRadius: 14, padding: '1.5rem 1.75rem',
                width: 560, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)',
              }}
            >
              <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, color: '#1E2225', margin: '0 0 0.75rem' }}>
                {targets.length}명에게 퇴고를 요청하시겠습니까?
              </h2>
              <ul style={{
                margin: '0 0 1rem', padding: '0.75rem 1rem 0.75rem 1.5rem',
                background: '#FAF5FF', border: '1px solid #E9D5FF', borderRadius: 8,
                fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.75,
              }}>
                <li><strong style={{ color: '#7C3AED' }}>1차 펜 데이터와 채점 결과는 그대로 보존</strong>되며, 차수 이력으로 남습니다.</li>
                <li>학생별로 <strong style={{ color: '#1E2225' }}>2차 답안지(새 번호표)</strong>가 발급됩니다. 출력해 배부해 주세요.</li>
                <li>대상 학생은 <strong style={{ color: '#1E2225' }}>미채점</strong> 단계로 돌아가며, 1차와 <strong style={{ color: '#1E2225' }}>동일하게</strong> 일괄 채점 · 스캔 채점 · 개별 펜 동기화로 채점합니다.</li>
                <li>AI 채점 횟수는 <strong style={{ color: '#1E2225' }}>2차에서 새로 {AI_GRADING_LIMIT_PER_ROUND}회</strong> 주어집니다 (1차 카운터와 독립).</li>
              </ul>

              <div style={{
                maxHeight: 200, overflowY: 'auto', border: '1px solid #E2E8F0',
                borderRadius: 8, marginBottom: '1.25rem',
              }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--neo-font-size-sm)' }}>
                  <thead>
                    <tr style={{ background: '#F8FAFC', color: '#64748B' }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700 }}>학생</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700 }}>1차 결과</th>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 700 }}>발급될 2차 번호표</th>
                    </tr>
                  </thead>
                  <tbody>
                    {targets.map(s => (
                      <tr key={s.id} style={{ borderTop: '1px solid #F1F5F9' }}>
                        <td style={{ padding: '8px 12px', fontWeight: 700, color: '#1E2225' }}>
                          {s.name} <span style={{ color: '#94A3B8', fontWeight: 400 }}>{s.grade}</span>
                        </td>
                        <td style={{ padding: '8px 12px', color: '#475569' }}>
                          AI {s.aiGrade} · 교사 {s.teacherGrade}
                        </td>
                        <td style={{ padding: '8px 12px', color: '#7C3AED', fontWeight: 700 }}>
                          {s.sheetNo} → {issueRevisionSheetNo(s.sheetNo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setIsRevisionRequestOpen(false)}
                  style={{
                    padding: '9px 18px', background: 'white', border: '1px solid #E2E8F0',
                    borderRadius: 8, fontWeight: 700, color: '#475569',
                    cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)', fontFamily: 'inherit',
                  }}
                >취소</button>
                <button
                  onClick={handleConfirmRevisionRequest}
                  style={{
                    padding: '9px 18px', background: '#7C3AED', border: 'none',
                    borderRadius: 8, fontWeight: 800, color: 'white',
                    cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)', fontFamily: 'inherit',
                  }}
                >✍ 퇴고 요청</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── [SCR-06] 퇴고 요청 완료 — 2차 답안지 배부 안내 ── */}
      {isV2 && revisionRequestResult && (
        <div
          className="modal-overlay"
          onClick={() => setRevisionRequestResult(null)}
          style={{ zIndex: 10000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: 14, padding: '1.5rem 1.75rem',
              width: 520, maxWidth: '92vw', boxShadow: '0 20px 50px rgba(15,23,42,0.25)',
            }}
          >
            <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, color: '#1E2225', margin: '0 0 0.5rem' }}>
              ✅ {revisionRequestResult.count}명 퇴고 요청 완료
            </h2>
            <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.7, margin: '0 0 1rem' }}>
              2차 답안지가 발급되었습니다. 아래 번호표로 출력해 학생에게 배부해 주세요.
작성이 끝나면 <strong>[미채점]</strong> 탭에서 1차와 동일하게 채점하세요.
              <span style={{ color: '#8A94A1' }}> (상단 <strong>[✍ 퇴고]</strong> 필터로 대상만 추릴 수 있습니다.)</span>
            </p>
            <div style={{
              maxHeight: 220, overflowY: 'auto', border: '1px solid #E2E8F0',
              borderRadius: 8, marginBottom: '1.25rem',
            }}>
              {revisionRequestResult.sheets.map((sheet, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 12px', borderTop: i === 0 ? 'none' : '1px solid #F1F5F9',
                    fontSize: 'var(--neo-font-size-sm)',
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#1E2225' }}>{sheet.name}</span>
                  <span style={{ color: '#7C3AED', fontWeight: 800 }}>{sheet.to}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  alert('2차 답안지 PDF 출력 — 프로토타입에서는 동작하지 않습니다.');
                }}
                style={{
                  padding: '9px 18px', background: 'white', border: '1px solid #CBD5E1',
                  borderRadius: 8, fontWeight: 700, color: '#475569',
                  cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)', fontFamily: 'inherit',
                }}
              >🖨 답안지 출력</button>
              <button
                onClick={() => setRevisionRequestResult(null)}
                style={{
                  padding: '9px 18px', background: '#2A75F3', border: 'none',
                  borderRadius: 8, fontWeight: 800, color: 'white',
                  cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)', fontFamily: 'inherit',
                }}
              >확인</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 백그라운드 채점 FAB ── 일괄/개별 공유 ──
          [v3.x] 일괄 채점 완료 시:
            · FAB 문구 「✓ 채점 완료」 + hint 「첫 채점 학생 상세 열기」
            · 클릭 → lastBulkGradedIds 중 첫 성공 학생의 SCR-03 상세 모달 자동 오픈 */}
      {(showFAB || bgIndividual) && !(isScanModalOpen && !scanMinimized) && (() => {
        const isIndividual = !!bgIndividual && !showFAB;
        const finished = isIndividual ? bgIndividual.isFinished : isGradingFinished;
        // 일괄 완료 상태에서 클릭 시 진입할 첫 성공 학생 (실패·미변경 케이스 제외)
        const firstGradedStudent = (!isIndividual && finished)
          ? lastBulkGradedIds
              .map((id) => students.find((s) => s.id === id))
              .find((s) => s && s.status === '채점 확인')
          : null;
        const mainText = isIndividual
          ? (finished ? '채점이 완료되었습니다.' : `AI가 ${bgIndividual.studentName} 채점하고 있어요.`)
          : (finished ? '✓ 채점 완료' : 'AI 가 채점하고 있어요.');
        // [SCR-05 v4.2] 최소화된 스캔 세션이면 FAB는 「창 복귀」 역할을 한다
        const isMinimizedScan = isScanModalOpen && scanMinimized;
        const hintText = isIndividual
          ? (finished ? '탭하여 상세 확인' : '잠시만 기다려 주세요.')
          : isMinimizedScan
            ? (finished ? '탭하여 완료 창 열기' : '탭하여 진행 상황 보기')
            : (finished
                ? (firstGradedStudent ? `탭하여 ${firstGradedStudent.name} 상세 열기` : '탭하여 결과 확인')
                : '잠시만 기다려 주세요.');
        const handleFabClick = () => {
          // [SCR-05 v4.2] 최소화된 스캔 채점 세션이 있으면 그 창을 다시 연다 (완료 창에 포커스)
          if (isMinimizedScan) { setScanMinimized(false); return; }
          if (isIndividual) {
            // 개별: 해당 학생 SCR-03 모달 자동 오픈
            const target = students.find(s => s.id === bgIndividual.studentId);
            if (target) {
              setSelectedStudent(target);
              setIsModalOpen(true);
            }
            setBgIndividual(null);
          } else if (finished && firstGradedStudent) {
            // [v3.x] 일괄 완료 → 첫 성공 학생 SCR-03 상세 자동 오픈. FAB 종료
            setSelectedStudent(firstGradedStudent);
            setIsModalOpen(true);
            setShowFAB(false);
            setIsGradingFinished(false);
            setLastBulkGradedIds([]);
          } else {
            // 일괄(진행 중 or 성공 학생 없음): 일괄 채점 워크플로우 모달(final_bulk) 다시 오픈
            setIsBulkModalOpen(true);
            setBulkStep('final_bulk');
            setShowFAB(false);
          }
        };
        return (
          <div
            className="grading-fab"
            style={{ position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', zIndex: 9999, background: 'white', borderRadius: '50px', padding: '1rem 2rem', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', border: `2px solid ${finished ? '#10B981' : '#2A75F3'}` }}
            onClick={handleFabClick}
            title={isMinimizedScan
              ? '클릭 시 스캔 일괄 채점 창을 다시 엽니다.'
              : (finished && !isIndividual && firstGradedStudent ? `클릭 시 「${firstGradedStudent.name}」 채점 상세 화면으로 이동합니다.` : undefined)}
          >
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            <div style={{ width: '24px', height: '24px', border: '3px solid #EBF2FF', borderTopColor: '#2A75F3', borderRadius: '50%', animation: finished ? 'none' : 'spin 1s linear infinite', background: finished ? '#10B981' : 'transparent', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {finished && <span style={{ color: 'white', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800 }}>✓</span>}
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 'var(--neo-font-size-base)', color: finished ? '#047857' : '#1E2225' }}>{mainText}</div>
              <div style={{ fontSize: 'var(--neo-font-size-xs)', color: finished ? '#059669' : '#8A94A1' }}>{hintText}</div>
            </div>
          </div>
        );
      })()}
    </>
  );
};

export default GradingManagement;
