/**
 * ScanGradingModal.jsx
 * [SCR-05] 스캔 일괄 채점 워크플로우 모달
 *
 * 목적: 스캔 파일을 순서·이름 정렬 없이 업로드 → 답안지 기재 내용을 OCR로 읽어
 *       학생·과제·문항을 판별 → 슬롯(학생 × 문항)에 연결 → AI 일괄 채점 → 채점 확인 단계로 전환
 *
 * 5-Step Workflow:
 *   1) upload      — 다중 스캔 파일 업로드 (PDF/PNG/JPG) + [v3.24] 대상 학생 게이트(1단)
 *   2) matching    — OCR 실행 + 학생/과제/문항 판별 (mock, 1.5초 후 자동 결과 생성)
 *   3) review      — 연결 결과 검토. 슬롯 매트릭스(기본) / 파일 목록(보조) 2뷰
 *   4) grading     — AI 일괄 채점 진행 (채점 대상 슬롯만, 5초 mock)
 *   5) completed   — 완료 요약 + [확인] 시 상위 콜백 호출 → 학생 상태 전환
 *
 * ─────────────────────────────────────────────────────────────────────────
 * [SCR-05 v4.0] OCR 매핑(A안) — 파일명 규칙·QR 없이 답안지 기재 내용만으로 판별
 *
 *   연결 단위가 「학생」에서 **「슬롯 = 학생 × 문항」**으로 바뀐다.
 *   한 슬롯에는 1장 이상의 답안지가 붙을 수 있다 (문항 하나를 여러 장에 이어 쓰는 경우).
 *
 *   판별 출처 (TSK-05 v3.5 답안지 서식):
 *     · 과제코드   — 시스템 인쇄값(활자). 타 과제 답안지 혼입 검출
 *     · 학년/반/번호 + 이름 — 학생 손글씨. **명단이라는 닫힌 집합과 대조**하므로
 *                            자유 텍스트 OCR이 아니라 후보 선택 문제가 된다
 *     · 문항 번호  — 학생 손글씨 숫자 1자리. 미기재·인식 실패 시 미분류로 안전하게 빠진다
 *
 *   QR 미채택 근거: QR은 「인쇄 시점의 진실」이고 OCR은 「작성 시점의 진실」이다.
 *   학생이 여분 답안지를 집어 쓰면 QR이 거짓을 말하고 그 오류는 조용히 잘못 채점된다.
 *   OCR 실패는 미분류로 빠져 교사에게 확인을 요구하는 안전한 실패다.
 *
 *   신뢰도 3단계 — 교사가 전부 확인하지 않고 애매한 것만 확인하도록 분류한다:
 *     · high   자동 확정   학생 2필드 이상 일치 + 과제코드 일치 + 문항 번호 인식
 *     · medium 확인 필요   일부 필드만 일치, 또는 문항을 AI가 내용으로 추론
 *     · low    미분류      판별 실패 → 미분류 트레이에서 수동 지정
 *
 *   슬롯 상태 (기준 장수 = TSK-02 「답안지 출력 장수 설정」):
 *     · ok       장수 == 기준
 *     · over     장수 >  기준 — 중복 스캔 의심
 *     · short    장수 <  기준 — 답안지가 덜 붙었다. **0장도 여기 포함**한다 `[v4.6]`
 *                (舊 `missing`(0장)은 차단·빈 장 자리·해소 방법이 short와 같아 흡수했다)
 *   덮어쓰기(overwrite)는 상태가 아니라 **플래그**다 (답안 있음 학생 + 장수 ≥ 1).
 *
 * [SCR-01 v3.24] 답안 기제출(`답안 있음`) 학생 처리 — 3단 게이트 (슬롯 단위로 승계)
 *   1단 (upload)  — `답안 있음` 학생은 대상에서 기본 제외
 *   [v4.2] 1단·2단 폐기 — `답안 있음` 학생도 전원 판별 대상이고, 연결된 슬롯은 즉시 채점 대상이다
 *   실행 직전 — 교체 슬롯이 1건 이상이면 확인 다이얼로그 1회 (**유일한 방어선**)
 *
 * [SCR-05 v4.0] 부분 제출 처리 — 누락 감지 시 3지선다
 *   · 있는 답안으로 계속 채점 (권장)  · 누락 학생 제외하고 채점  · 취소하고 파일 추가
 *   「계속 채점」에서도 답안지가 한 장도 없는 문항은 채점 대상이 아니다. 한 장이라도 붙은
 *   문항은 기준 장수가 어디까지나 **예상값**이므로 있는 장만으로 채점한다.
 */
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

const STEPS = [
  { key: 'upload', label: '파일 업로드', icon: '📁' },
  { key: 'matching', label: 'OCR 판별', icon: '🔎' },
  { key: 'review', label: '연결 결과 확인', icon: '📋' },
  { key: 'grading', label: 'AI 일괄 채점', icon: '🤖' },
  { key: 'completed', label: '완료', icon: '✓' },
];

// [v4.0] 슬롯 상태 토큰 — 기준 장수 대비 실제 장수로 판정
const SLOT_TOKEN = {
  ok: { label: '연결', bg: '#F0FDF4', border: '#86EFAC', color: '#166534' },
  over: { label: '답안지 초과', bg: '#EFF6FF', border: '#93C5FD', color: '#1D4ED8' },
  /* [v4.6] 舊 `missing`(0장) 폐기 — `short`에 흡수. 0장도 차단 대상이므로
   * 중립 회색이 아니라 주의 노랑으로 보이는 편이 실제 의미와 맞다. */
  short: { label: '답안지 부족', bg: '#FFFBEB', border: '#FDE68A', color: '#92400E' },
};

/* [v4.6] 좌측 학생 × 문항 매트릭스의 문항 칸 폭.
 * 상태 라벨이 `초과`/`부족` → `답안지 초과`/`답안지 부족`으로 길어져 66px로는 넘쳤다.
 * 좌측 패널 폭(352 → 392)도 같은 양만큼 늘려 학생 이름 칸이 줄지 않게 했다. */
const SLOT_CELL_W = 78;

// [v4.0] OCR 신뢰도 3단계
const CONFIDENCE_TOKEN = {
  high: { label: '자동 확정', bg: '#DCFCE7', color: '#166534', dot: '🟢' },
  medium: { label: '확인 필요', bg: '#FEF3C7', color: '#92400E', dot: '🟡' },
  low: { label: '미분류', bg: '#FEE2E2', color: '#991B1B', dot: '🔴' },
};

const ScanGradingModal = ({
  open, onClose, selectedStudents = [], onCompleted, onMinimize, onGradingFinished,
  groupLabel = '그룹1', taskTitle = '과제',
  questions = [], taskCode = '00000594',
}) => {
  const [step, setStep] = useState('upload');
  const [files, setFiles] = useState([]); // { id, name, size, source, kind, previewUrl }
  const [matchResults, setMatchResults] = useState([]); // 파일별 OCR 판별 + 확정 연결
  const [gradingProgress, setGradingProgress] = useState(0);
  const [gradingFinished, setGradingFinished] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [previewFileId, setPreviewFileId] = useState(null);
  // [v3.24] 3단 게이트 — 채점 직전 덮어쓰기 확인 다이얼로그
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  // [v4.7] 판별 직후 교체 의사를 한 번 묻는 창 (전체 스캔으로 기존 답안이 밀려난 경우)
  const [confirmReplace, setConfirmReplace] = useState(false);
  // [v4.2] 리뷰 — 좌측 학생 목록에서 고른 대상. 학생 id 또는 'unassigned'(미분류 트레이)
  const [selectedKey, setSelectedKey] = useState(null);
  // [v4.10] 답안지 작업 팝오버 — 열린 메뉴와 그 버튼의 화면 좌표.
  // 카드/열이 overflow:hidden이라 팝오버를 그 안에 그리면 잘린다. body로 포털해 fixed로 띄운다.
  const [openMenu, setOpenMenu] = useState(null); // { key, top, left, right }
  // [v4.4] 답안지 코드 — 평소엔 숨기고 클릭했을 때만 보여준다
  const [showCodeList, setShowCodeList] = useState(false);   // 헤더: 문항별 전체 목록

  useEffect(() => {
    return () => { files.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const seqRef = files.length ? Math.max(...files.map((f) => f.id)) + 1 : 1;
  const stepIdx = STEPS.findIndex((s) => s.key === step);

  // 문항 목록 — sheets = TSK-02 「답안지 출력 장수 설정」(문항별 기준 장수, 미설정 시 1)
  const questionList = (questions.length ? questions : [{ id: 1, title: '문항 1' }])
    .map((q) => ({ ...q, sheets: q.sheets || 1 }));

  // ─── [v3.24] 답안 기제출 학생 판별 ───
  const isAnswerStudent = (s) => s?.submitType === 'ocr';
  const answerStudents = selectedStudents.filter(isAnswerStudent);
  const answerIdSet = new Set(answerStudents.map((s) => s.id));
  // [v4.2] `답안 있음` 학생도 제외하지 않는다 — 선택된 학생 전원이 OCR 판별·채점 대상
  const targetStudents = selectedStudents;

  const slotKey = (studentId, questionNo) => `${studentId}:${questionNo}`;

  /* [v4.4] 기존 답안 행 — 판별 직후 슬롯에 올릴 때와, 교체를 되돌릴 때 **같은 함수**로 만든다.
   * 한쪽만 바뀌면 「되돌렸는데 다른 카드가 올라온다」가 되므로 생성 지점을 하나로 묶는다.
   *
   * [v4.7] `home{StudentId,QuestionNo}` — 이 답안이 원래 어느 자리의 것인지 항상 들고 다닌다.
   * 스캔본에 밀려 미분류로 내려가도 제자리를 알고 있어야 [↩ 되돌리기]가 가능하다.
   * `attach`가 false면 미분류로 만든다 (전체 스캔에서 그 자리를 스캔본이 이미 차지한 경우). */
  const buildExistingRow = (st, q, attach = true) => ({
    fileId: `exist-${st.id}-${q.id}`,
    fileName: `${st.name} 기존 답안 · ${q.title}`,   // [v4.7] 문항까지 적어야 여러 건을 구분한다
    origin: 'existing',
    homeStudentId: st.id,
    homeQuestionNo: q.id,
    submitPath: st.id % 2 === 0 ? '키보드 입력' : '파일 업로드',
    submittedAt: '2026-08-30 14:12',
    ocrSheetCode: null, ocrStudentText: '', ocrNameText: '', ocrQuestionNo: null, ocrPageNo: null,
    studentId: attach ? st.id : null,
    questionNo: attach ? q.id : null,
    sheetNo: null,
    studentInput: `${st.name} (${st.grade || ''})`.replace(' ()', ''),
    confidence: 'high',
    inferred: false,
  });

  // [v4.5] 문항 셀렉트 값 — 다장 문항은 `1-2`(문항1의 2장째)까지 고를 수 있어야
  // 부족한 장을 정확히 채울 수 있다. 한 장짜리 문항은 장 번호를 두지 않는다.
  const questionValueOf = (r) => (r.questionNo == null ? '' : (r.sheetNo != null ? `${r.questionNo}-${r.sheetNo}` : String(r.questionNo)));
  const parseQuestionValue = (v) => {
    if (!v) return { questionNo: null, sheetNo: null };
    const [qs, ps] = String(v).split('-');
    return { questionNo: Number(qs), sheetNo: ps ? Number(ps) : null };
  };
  const questionOptions = () => questionList.flatMap((q) => (q.sheets > 1
    ? Array.from({ length: q.sheets }, (_, i) => ({ value: `${q.id}-${i + 1}`, label: `${q.title}-${i + 1}` }))
    : [{ value: String(q.id), label: q.title }]));

  /**
   * [v4.4] 답안지 코드 — **과제당 1개가 아니라 「장」마다 1개**다.
   * 코드 개수 = 문항별 기준 장수의 합 (문항당 최대 10장).
   * 여기서는 taskCode를 시작값으로 문항 순서 → 장 순서대로 1씩 올려 mock 생성한다.
   * 실제 서비스에서는 답안지 출력 시점에 발급된 코드 목록을 그대로 받아야 한다.
   */
  const sheetCodeList = (() => {
    const width = String(taskCode).length || 8;
    let seq = parseInt(taskCode, 10);
    if (Number.isNaN(seq)) seq = 0;
    const out = [];
    questionList.forEach((q) => {
      for (let page = 1; page <= Math.min(q.sheets, 10); page += 1) {
        out.push({ questionId: q.id, question: q, page, code: String(seq).padStart(width, '0') });
        seq += 1;
      }
    });
    return out;
  })();
  const sheetCodeOf = (questionId, page) => {
    const hit = sheetCodeList.find((x) => x.questionId === questionId && x.page === page);
    return hit ? hit.code : null;
  };
  const sheetCodeSet = new Set(sheetCodeList.map((x) => x.code));

  // [v4.1] 문항 순번 — 「문항 1」만 보면 과제에 문항이 몇 개인지 알 수 없다.
  // 표기 규칙: 단위 없는 `n/m`은 **페이지(장)** 를 뜻하므로, 문항 순번은 `N번째`로 적어 구분한다.
  const questionOrder = (q) => questionList.findIndex((x) => x.id === q.id) + 1;

  // [v4.2] 학생 표기 — 콤보박스 입력값과 datalist 후보에 동일하게 쓴다
  const studentLabel = (s) => (s ? `${s.name} (${s.grade || ''})`.replace(' ()', '') : '');

  // [v4.2] OCR이 읽은 문항 표기 — 기준 장수가 2장 이상인 문항은 `문항 1-1`처럼
  // 「문항번호-장번호」로 적는다. 한 장짜리 문항은 그냥 `문항 3`.
  const ocrQuestionLabel = (r) => {
    if (r.ocrQuestionNo == null) return '(미기재)';
    const q = questionList.find((x) => x.id === r.ocrQuestionNo);
    return (q && q.sheets > 1 && r.ocrPageNo) ? `문항 ${r.ocrQuestionNo}-${r.ocrPageNo}` : `문항 ${r.ocrQuestionNo}`;
  };


  const handleFilesAdd = (fileList) => {
    const next = Array.from(fileList).map((f, i) => {
      const isImage = (f.type || '').startsWith('image/') || /\.(png|jpe?g)$/i.test(f.name || '');
      const isPdf = (f.type || '') === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      return {
        id: seqRef + i,
        name: f.name || `scan_${i}.jpg`,
        size: f.size || 1_200_000,
        source: 'user',
        kind: isImage ? 'image' : isPdf ? 'pdf' : 'unknown',
        previewUrl: isImage ? URL.createObjectURL(f) : null,
      };
    });
    setFiles((prev) => [...prev, ...next]);
  };

  const handleRemoveFile = (id) => {
    setFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
    setMatchResults((prev) => prev.filter((r) => r.fileId !== id));
  };

  /* [v4.6] 업로드 초기화 — [전체 삭제]와 [← 파일 다시 선택]이 같은 동작을 쓴다.
   * 「파일 다시 선택」은 말 그대로 처음부터 다시 고르는 것이므로 이전 업로드와
   * 판별 결과를 남기지 않는다. 미리보기 URL도 함께 해제해야 파일을 여러 번
   * 갈아 끼울 때 메모리에 쌓이지 않는다. */
  const resetUploads = () => {
    files.forEach((f) => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
    setFiles([]);
    setMatchResults([]);
    setSelectedKey(null);
    setOpenMenu(null);
    setPreviewFileId(null);
  };

  // mock 파일 — 학생 × 문항 × 기준 장수만큼 생성하되, 일부러 상태를 흩뜨려
  // 연결 결과 확인(Step 3)의 상태 그룹이 모두 채워지도록 만든다
  const injectMockFiles = () => {
    const seed = files.length + 1;
    const plan = [];
    targetStudents.forEach((s, si) => {
      /* [v4.7] `답안 있음` 학생도 스캔을 만든다 — 舊 v4.4의 「만들지 않는다」 폐기.
       * 실제 운영에서 교사는 답안 유무를 가리지 않고 반 전체를 통째로 스캔하므로,
       * 데모도 그 상황(= 교체 발생)을 그대로 재현해야 화면을 검증할 수 있다. */
      questionList.forEach((q, qi) => {
        // 시연용 결손: 3번째 학생의 마지막 문항은 통째로 누락
        if (si === 2 && qi === questionList.length - 1) return;  // 0장 → `부족 0/N장`
        let need = q.sheets;
        if (si === 1 && qi === 0 && q.sheets > 1) need = q.sheets - 1; // 부족(short)
        if (si === 0 && qi === 1) need = q.sheets + 1;                 // 초과(over) — 중복 스캔 시연
        for (let p = 0; p < need; p += 1) plan.push({ s, q, page: p + 1 });
      });
    });
    // 판별 실패 1건(미분류 시연)은 상한에 잘리지 않도록 자른 뒤에 붙인다
    const capped = plan.slice(0, 23);
    capped.push({ s: null, q: null, page: 1 });
    const mock = capped.map((it, i) => ({
      id: seed + i,
      name: `scan_${String(seed + i).padStart(4, '0')}.jpg`,
      size: 1_000_000 + i * 40_000,
      source: 'mock',
      kind: 'mock',
      previewUrl: null,
      _plan: it,
    }));
    setFiles((prev) => [...prev, ...mock]);
  };

  /**
   * Step 2: OCR 판별 (mock)
   * 실제 서비스에서는 OCR API가 파일별로 아래 필드를 돌려준다:
   *   { taskCode, gradeClassNo, name, questionNo } + 각 필드 신뢰도
   * 여기서는 mock 파일에 심어둔 _plan을 그대로 읽되, 일부를 medium/low로 떨어뜨려
   * 신뢰도 3단계 흐름(자동 확정 / 확인 필요 / 미분류)을 재현한다.
   */
  const startMatching = () => {
    if (!files.length) return;
    setStep('matching');
    setTimeout(() => {
      const rows = files.map((f, i) => {
        const plan = f._plan;
        const s = plan?.s || targetStudents[i % Math.max(targetStudents.length, 1)] || null;
        const q = plan?.q || questionList[i % questionList.length];
        const noPlanStudent = plan ? !plan.s : false;

        // 판별 실패 (미분류)
        if (noPlanStudent) {
          return {
            fileId: f.id, fileName: f.name,
            ocrSheetCode: null, ocrStudentText: '(인식 실패)', ocrNameText: '', ocrQuestionNo: null, ocrPageNo: null,
            studentId: null, questionNo: null, sheetNo: null, confidence: 'low', inferred: false,
          };
        }
        // 매 4번째 파일은 문항 번호 미기재 → AI 내용 추론 → medium
        const questionMissed = i % 4 === 3;
        return {
          fileId: f.id, fileName: f.name,
          // 답안지 코드는 인쇄값이라 학생 필기와 무관하게 읽힌다 (장 = 코드 1개)
          ocrSheetCode: sheetCodeOf(q.id, plan?.page ?? 1),
          ocrStudentText: s ? s.grade : '',
          ocrNameText: s ? s.name : '',
          ocrQuestionNo: questionMissed ? null : q.id,
          ocrPageNo: questionMissed ? null : (plan?.page ?? null), // 다장 문항의 「문항 1-2」 표기용
          studentId: s ? s.id : null,
          questionNo: q.id,
          sheetNo: q.sheets > 1 ? (plan?.page ?? null) : null,
          confidence: questionMissed ? 'medium' : 'high',
          inferred: questionMissed,
        };
      });
      /* [v4.4] `답안 있음` 학생의 기존 답안을 **슬롯에 붙은 카드**로 함께 올린다.
       * 기존 답안은 「장」이 아니라 「제출 1건」이므로 기준 장수와 비교하지 않는다(§4.5).
       *
       * [v4.7] 전체 스캔 대응 — 교사는 보통 답안 유무를 가리지 않고 **반 전체를 통째로** 스캔한다.
       * 그러면 `답안 있음` 학생 자리에도 스캔본이 붙는다. 이때 한 슬롯에 두 답안을 겹쳐 두면
       * 「무엇으로 채점되는지」가 화면에도 코드에도 드러나지 않으므로, **스캔본을 자리에 두고
       * 기존 답안은 미분류로 내린다.** 사라지지 않으므로 채점 전까지 언제든 되돌릴 수 있다. */
      const taken = new Set(rows.filter((r) => r.studentId != null && r.questionNo != null)
        .map((r) => slotKey(r.studentId, r.questionNo)));
      const existingRows = answerStudents.flatMap((st) => questionList.map(
        (q) => buildExistingRow(st, q, !taken.has(slotKey(st.id, q.id)))));
      setMatchResults([...rows, ...existingRows]);
      setStep('review');
      // 교체가 발생하면 **판별 결과를 보여준 뒤** 교체 의사를 한 번 묻는다 (판별 전에 묻지 않는다)
      if (existingRows.some((r) => r.studentId == null)) setConfirmReplace(true);
    }, 1500);
  };

  // 파일의 학생/문항 확정값 변경 — 교사가 직접 지정하면 신뢰도는 high로 승격
  const updateAssign = (fileId, patch) => {
    const before = matchResults.find((r) => r.fileId === fileId);
    setMatchResults((prev) => {
      const next = prev.map((r) => {
        if (r.fileId !== fileId) return r;
        const nx = { ...r, ...patch };
        nx.confidence = (nx.studentId != null && nx.questionNo != null) ? 'high' : 'low';
        nx.inferred = false;
        return nx;
      });
      /* [v4.7] 舊 자동 복원 폐기 — 기존 답안은 교체돼도 사라지지 않고 **미분류에 실체로 남는다.**
       * 여기서 다시 만들어 붙이면 같은 답안이 둘이 된다. 복원은 교사가 [↩ 되돌리기]로 한다. */
      return next;
    });
  };

  /* [v4.7] 교체 되돌리기 — 미분류에 내려온 기존 답안을 원래 자리로 올리고,
   * 그 자리를 차지하고 있던 스캔본을 미분류로 내린다. 자리는 언제나 한쪽만 차지한다. */
  const restoreExisting = (row) => {
    const sid = row.homeStudentId; const qid = row.homeQuestionNo;
    setMatchResults((prev) => prev.map((r) => {
      if (r.fileId === row.fileId) return { ...r, studentId: sid, questionNo: qid };
      if (r.origin !== 'existing' && r.studentId === sid && r.questionNo === qid) {
        return { ...r, studentId: null, questionNo: null, sheetNo: null, studentInput: '', confidence: 'low', inferred: false };
      }
      return r;
    }));
  };

  const confirmFile = (fileId) => {
    setMatchResults((prev) => prev.map((r) => (r.fileId === fileId ? { ...r, confidence: 'high', inferred: false } : r)));
  };

  // ─── 슬롯(학생 × 문항) 파생 ───
  const assigned = matchResults.filter((r) => r.studentId != null && r.questionNo != null);
  const unassigned = matchResults.filter((r) => r.studentId == null || r.questionNo == null);
  /* [v4.7] 미분류 트레이는 성격이 다른 둘을 담는다 — 섞어 놓으면 「판별 실패」로 오해한다.
   *  · unassignedScans   어느 자리에도 없는 스캔(판별 실패 + 되돌리기로 내려온 것). 채점되지 않는다
   *  · replacedExistings 스캔본에 자리를 내준 기존 답안. 이상이 아니라 **교체의 결과**다 */
  const unassignedScans = unassigned.filter((r) => r.origin !== 'existing');
  const replacedExistings = unassigned.filter((r) => r.origin === 'existing');
  // [v4.7] 교체 대상 **학생** 이름 — 한 학생이 여러 문항을 갖더라도 한 번만 적는다
  const replacedStudentNames = [...new Set(replacedExistings.map((r) => r.homeStudentId))]
    .map((id) => targetStudents.find((x) => x.id === id)?.name)
    .filter(Boolean);
  // 모두 되돌리기 — 교체 의사 확인창의 [기존 답안으로 채점]이 쓴다
  const restoreAllExisting = () => replacedExistings.forEach(restoreExisting);

  const slots = [];
  const slotIndex = {};
  targetStudents.forEach((s) => {
    questionList.forEach((q) => {
      const slot = { key: slotKey(s.id, q.id), student: s, question: q, files: [] };
      slots.push(slot);
      slotIndex[slot.key] = slot;
    });
  });
  assigned.forEach((r) => {
    const slot = slotIndex[slotKey(r.studentId, r.questionNo)];
    if (slot) slot.files.push(r);
  });
  // 지정된 장 번호 순서대로. 번호가 없는 것(한 장 문항·수동 지정)은 뒤로
  slots.forEach((sl) => sl.files.sort((a, b) => (a.sheetNo ?? 99) - (b.sheetNo ?? 99)));

  // [v4.5] 이 문항에 교사 확인이 필요한 답안지가 있나 (AI 추정 등 medium)
  const slotNeedsCheck = (sl) => sl.files.some((f) => f.confidence === 'medium');

  const slotStatus = (slot) => {
    if (slotHasExisting(slot)) return 'ok';
    const n = slot.files.length;
    const need = slot.question.sheets;
    if (n < need) return 'short';   // [v4.6] 0장도 `부족`. 舊 `missing` 분기 폐기
    if (n > need) return 'over';
    return 'ok';
  };
  /* [v4.4] 기존 답안이 붙은 슬롯은 「제출 1건」으로 채워진 것으로 보고 기준 장수와 비교하지 않는다.
   * 기존 답안은 파일이 아니라 학생이 이미 낸 제출물이라 「몇 장」이라는 개념 자체가 없다. */
  const slotHasExisting = (slot) => slot.files.some((f) => f.origin === 'existing');
  /* 교체 판정 — 원래 기존 답안이 있던 슬롯인데 지금은 없다면 스캔본으로 갈아끼운 것이다.
   * 별도 state 없이 현재 구성만으로 도출되므로 되돌리거나 다시 교체해도 항상 일치한다. */
  const slotReplacedExisting = (slot) => answerIdSet.has(slot.student.id) && !slotHasExisting(slot) && slot.files.length > 0;

  // 채점 대상 슬롯 판정
  const isGradableSlot = (sl) => {
    // [v4.2] 답안지가 붙은 슬롯은 전부 채점 대상. 누락 슬롯은 조용히 빠지고 별도 안내를 띄우지 않는다
    if (sl.files.length === 0) return false;
    return true;
  };
  const gradableSlots = slots.filter(isGradableSlot);
  const gradableStudentIds = [...new Set(gradableSlots.map((sl) => sl.student.id))];
  const replacedSlots = slots.filter(slotReplacedExisting);
  // 실제로 기존 답안을 교체하게 되는 슬롯 수 (= 채점 대상이면서 `답안 있음` 학생)
  const replacedCount = gradableSlots.filter(slotReplacedExisting).length;
  // 기준 장수에 못 미치는 채로 채점된 문항 — 교사가 완료 후 인지해야 하므로 별도 카운트
  const shortGradedCount = gradableSlots.filter((sl) => slotStatus(sl) === 'short').length;

  /* ─── [v4.3] 채점 시작 차단 조건 ───
   * 미분류 파일은 **무시**한다 (어느 슬롯에도 붙지 않아 채점에 관여하지 않음).
   * 슬롯이 하나라도 `초과`·`부족`이거나, 연결된 답안지에 `확인 필요`가 남아 있으면 막는다.
   * 舊 v4.2는 이 상황들을 통과시키고 완료 요약에서 고지만 했으나,
   * 「데이터가 덜 갖춰진 채로 채점이 확정된다」는 문제가 커서 사전 차단으로 전환했다. */
  const abnormalSlots = slots.filter((sl) => slotStatus(sl) !== 'ok');
  const pendingCheckFiles = assigned.filter((r) => r.confidence === 'medium');
  const startBlocked = gradableSlots.length === 0 || abnormalSlots.length > 0 || pendingCheckFiles.length > 0;
  // 무엇 때문에 막혔는지 교사에게 그대로 알려준다 — 「비활성인데 이유를 모르겠다」가 가장 나쁜 상태다
  const startBlockReason = (() => {
    if (gradableSlots.length === 0) return '채점 대상이 없습니다. 학생·문항에 연결된 답안지가 한 건도 없습니다.';
    const parts = [];
    const n = (st) => abnormalSlots.filter((sl) => slotStatus(sl) === st).length;
    if (n('over')) parts.push(`답안지 초과 ${n('over')}건`);
    if (n('short')) parts.push(`답안지 부족 ${n('short')}건`);
    if (pendingCheckFiles.length) parts.push(`확인 필요 ${pendingCheckFiles.length}장`);
    return `${parts.join(' · ')}을(를) 먼저 정리해 주세요. 모든 문항이 기준 장수를 채우고 확인이 끝나야 채점을 시작할 수 있습니다.`;
  })();

  // 전 문항이 채점된 학생만 `채점 확인`으로 전환. 일부만 채점된 학생은 미채점에 남는다
  const fullyGradedStudentIds = targetStudents
    .filter((s) => questionList.every((q) => {
      const sl = slotIndex[slotKey(s.id, q.id)];
      return sl && isGradableSlot(sl);
    }))
    .map((s) => s.id);
  const partiallyGradedCount = gradableStudentIds.length - fullyGradedStudentIds.length;


  // 미분류 파일을 특정 슬롯으로 바로 지정 (부족 슬롯의 빈 장 자리에서 호출)
  const assignFileToSlot = (fileId, sl, sheetNo = null) => updateAssign(fileId, {
    studentId: sl.student.id, questionNo: sl.question.id, sheetNo,
  });

  /**
   * [v4.7] 이미 붙어 있는 장을 **다른 파일로 교체**한다.
   *  · swapSlotFile   — 미분류 파일과 자리를 맞바꾼다 (기존 파일은 미분류로 내려간다)
   *  · replaceByUpload — 새로 올린 파일을 그 자리에 붙이고 기존 파일은 목록에서 뺀다
   */
  const swapSlotFile = (oldRow, newFileId) => {
    const owner = targetStudents.find((x) => x.id === oldRow.studentId);
    setMatchResults((prev) => prev.flatMap((row) => {
      if (row.fileId === oldRow.fileId) {
        /* [v4.7] 기존 답안도 **미분류로 내려간다** (舊 v4.4의 「목록에서 사라진다」 폐기).
         * 사라지면 잘못 교체한 순간 복구 수단이 없고, 교사가 채점 전까지 무엇을 밀어냈는지
         * 확인할 방법도 없다. 미분류에 남겨 두면 [↩ 되돌리기] 한 번으로 제자리로 간다. */
        return [{ ...row, studentId: null, questionNo: null, sheetNo: null, studentInput: '', confidence: 'low', inferred: false }];
      }
      if (row.fileId === newFileId) {
        return {
          ...row,
          studentId: oldRow.studentId,
          questionNo: oldRow.questionNo,
          sheetNo: oldRow.sheetNo,
          studentInput: studentLabel(owner),
          confidence: 'high',
          inferred: false,
        };
      }
      return row;
    }));
  };

  const replaceByUpload = (fileList, oldRow) => {
    const picked = Array.from(fileList || [])[0];
    if (!picked) return;
    const isImage = (picked.type || '').startsWith('image/') || /\.(png|jpe?g)$/i.test(picked.name || '');
    const isPdf = (picked.type || '') === 'application/pdf' || /\.pdf$/i.test(picked.name || '');
    const entry = {
      id: seqRef,
      name: picked.name || 'scan.jpg',
      size: picked.size || 0,
      source: 'user',
      kind: isImage ? 'image' : isPdf ? 'pdf' : 'unknown',
      previewUrl: isImage ? URL.createObjectURL(picked) : null,
    };
    const owner = targetStudents.find((x) => x.id === oldRow.studentId);
    setFiles((prev) => {
      const gone = prev.find((f) => f.id === oldRow.fileId);
      if (gone && gone.previewUrl) URL.revokeObjectURL(gone.previewUrl);
      return [...prev.filter((f) => f.id !== oldRow.fileId), entry];
    });
    /* [v4.7] 밀려나는 쪽 처리 — 기존 답안은 **지우지 않고 미분류로 내린다.**
     * 여기서 지우면 [⋯ → 파일 업로드]로 교체한 순간 학생 답안이 화면에서 사라져 되돌릴 수 없다. */
    setMatchResults((prev) => [
      ...prev.flatMap((x) => {
        if (x.fileId !== oldRow.fileId) return [x];
        if (x.origin !== 'existing') return [];
        return [{ ...x, studentId: null, questionNo: null }];
      }),
      {
      fileId: entry.id,
      fileName: entry.name,
      ocrSheetCode: sheetCodeOf(oldRow.questionNo, oldRow.sheetNo ?? 1),
      ocrStudentText: '', ocrNameText: '', ocrQuestionNo: null, ocrPageNo: null,
      studentId: oldRow.studentId,
      questionNo: oldRow.questionNo,
      sheetNo: oldRow.sheetNo,
      studentInput: studentLabel(owner),
      confidence: 'high',
      inferred: false,
      manual: true,
      },
    ]);
  };

  /**
   * [v4.6] 빈 장 자리에서 바로 업로드 — 파일을 추가하면서 그 자리(학생 × 문항 × 장)에 곧장 붙인다.
   * OCR을 거치지 않고 교사가 자리를 지정한 것이므로 신뢰도는 high(직접 지정)로 둔다.
   * OCR 판독 칸에는 판독값 대신 「직접 추가」임을 밝혀 자동 판별분과 구분되게 한다.
   */
  const addFileToSlot = (fileList, sl, sheetNo = null) => {
    const picked = Array.from(fileList || [])[0];
    if (!picked) return;
    const isImage = (picked.type || '').startsWith('image/') || /\.(png|jpe?g)$/i.test(picked.name || '');
    const isPdf = (picked.type || '') === 'application/pdf' || /\.pdf$/i.test(picked.name || '');
    const entry = {
      id: seqRef,
      name: picked.name || 'scan.jpg',
      size: picked.size || 0,
      source: 'user',
      kind: isImage ? 'image' : isPdf ? 'pdf' : 'unknown',
      previewUrl: isImage ? URL.createObjectURL(picked) : null,
    };
    setFiles((prev) => [...prev, entry]);
    setMatchResults((prev) => [...prev, {
      fileId: entry.id,
      fileName: entry.name,
      ocrSheetCode: sheetCodeOf(sl.question.id, sheetNo ?? 1),
      ocrStudentText: '', ocrNameText: '', ocrQuestionNo: null, ocrPageNo: null,
      studentId: sl.student.id,
      questionNo: sl.question.id,
      sheetNo,
      studentInput: studentLabel(sl.student),
      confidence: 'high',
      inferred: false,
      manual: true,
    }]);
  };

  // ─── 채점 시작 게이트 ───
  // [v4.2] 누락 안내(舊 3지선다) 폐기 — 매핑된 답안만으로 즉시 채점을 시작한다
  const requestGrading = () => {
    // 유일한 덮어쓰기 방어선 — 여기서 취소하면 기존 답안은 그대로 유지된다
    if (replacedCount > 0) { setConfirmOverwrite(true); return; }
    startGrading();
  };

  const startGrading = () => {
    setConfirmOverwrite(false);
    setStep('grading');
    setGradingProgress(0);
    setGradingFinished(false);
    const startAt = Date.now();
    const tick = () => {
      const pct = Math.min(100, Math.round(((Date.now() - startAt) / 5000) * 100));
      setGradingProgress(pct);
      if (pct >= 100) {
        setGradingFinished(true);
        setStep('completed');
        onGradingFinished?.();   // [v4.2] 최소화 상태여도 FAB를 「채점 완료」로 전환
        return;
      }
      setTimeout(tick, 180);
    };
    tick();
  };

  const handleConfirmComplete = () => {
    if (typeof onCompleted === 'function') onCompleted(fullyGradedStudentIds);
  };

  // [v4.2] 닫기 정책
  //   upload            → 즉시 종료(진행한 작업 없음)
  //   matching · review → 확인 다이얼로그 후 종료(판별 결과 폐기)
  //   grading · completed → **최소화**. 채점은 계속 진행되고 FAB로 다시 열 수 있다
  const handleCloseAttempt = () => {
    if (step === 'grading' || step === 'completed') {
      onMinimize?.({ finished: step === 'completed' || gradingFinished });
      return;
    }
    if (step === 'upload') { onClose?.(); return; }
    setConfirmClose(true);
  };
  const forceClose = () => { setConfirmClose(false); onClose?.(); };

  // ─────────── UI ───────────
  const sectionCard = { background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px 20px' };

  return (
    <div onClick={handleCloseAttempt} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#F8FAFC', borderRadius: 16, width: '92vw', height: '90vh', maxWidth: '92vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        {/* 헤더 */}
        <div style={{ padding: '18px 24px 12px', background: 'white', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>📷 스캔 일괄 채점</h2>
            <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginTop: 4 }}>
              그룹 <strong style={{ color: '#1E293B' }}>{groupLabel}</strong> · 과제 <strong style={{ color: '#1E293B' }}>{taskTitle}</strong>
              {' · '}
              <span style={{ position: 'relative', display: 'inline-block' }}>
                <button onClick={() => setShowCodeList((v) => !v)}
                  style={{ padding: '1px 8px', borderRadius: 999, border: `1px solid ${showCodeList ? '#2A75F3' : '#CBD5E1'}`, background: showCodeList ? '#EFF6FF' : 'white', color: showCodeList ? '#1D4ED8' : '#64748B', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, cursor: 'pointer' }}>
                  🏷 답안지 코드 {sheetCodeList.length}개
                </button>
                {showCodeList && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20, background: 'white', border: '1px solid #CBD5E1', borderRadius: 10, boxShadow: '0 8px 20px rgba(15,23,42,0.18)', padding: '10px 12px', minWidth: 260, maxHeight: 260, overflowY: 'auto' }}>
                    <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', marginBottom: 6 }}>
                      답안지 <strong style={{ color: '#1E293B' }}>1장마다 코드 1개</strong>가 부여됩니다.
                    </div>
                    {questionList.map((q) => {
                      const codes = sheetCodeList.filter((x) => x.questionId === q.id);
                      return (
                        <div key={q.id} style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '3px 0', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#475569', minWidth: 54 }}>{q.title}</span>
                          {codes.map((x) => (
                            <span key={x.code} style={{ padding: '1px 6px', borderRadius: 5, background: '#F1F5F9', border: '1px solid #E2E8F0', fontFamily: 'monospace', fontSize: 'var(--neo-font-size-xs)', color: '#1E293B' }}>
                              {x.code}<span style={{ color: '#94A3B8' }}>({x.page}/{codes.length})</span>
                            </span>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </span>
            </div>
          </div>
          <button onClick={handleCloseAttempt} aria-label="닫기" style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#64748B', padding: 4 }}>✕</button>
        </div>

        {/* 스텝 프로그레스 */}
        <div style={{ display: 'flex', padding: '12px 24px', gap: 4, background: 'white', borderBottom: '1px solid #E2E8F0' }}>
          {STEPS.map((s, i) => {
            const isActive = i === stepIdx;
            const isDone = i < stepIdx;
            return (
              <div key={s.key} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, background: isActive ? '#EFF6FF' : isDone ? '#F0FDF4' : 'transparent', color: isActive ? '#1D4ED8' : isDone ? '#047857' : '#94A3B8', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700 }}>
                <span>{isDone ? '✓' : s.icon}</span>
                <span>{i + 1}. {s.label}</span>
              </div>
            );
          })}
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, minHeight: 0, padding: '20px 24px', ...(step === 'review'
          ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' }
          : { overflowY: 'auto' }) }}>
          {/* ── Step 1: 업로드 ── */}
          {step === 'upload' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* [v4.3] 드롭존 — 한 줄로 압축. 안내문을 따로 카드로 빼지 않고 여기에 흡수했다 */}
              <div style={{ ...sectionCard, borderStyle: 'dashed', borderColor: '#93C5FD', background: '#F0F9FF', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFilesAdd(e.dataTransfer.files); }}>
                <span style={{ fontSize: '1.5rem' }}>📁</span>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#1E3A8A' }}>스캔 파일을 끌어놓거나 선택하세요</div>
                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', marginTop: 2 }}>
                    PDF · PNG · JPG · 20MB 이하 · <strong>파일명·순서 무관</strong> — 답안지에 적힌 학년/반/번호 · 이름 · 문항을 OCR로 읽어 자동 연결합니다.
                  </div>
                </div>
                <div style={{ display: 'inline-flex', gap: 8 }}>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, background: '#2A75F3', color: 'white', fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, cursor: 'pointer' }}>
                    파일 선택
                    <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
                      /* [v4.6] 초기화 후 같은 파일을 다시 골라도 onChange가 뜨도록 값을 비운다 */
                      onChange={(e) => { handleFilesAdd(e.target.files); e.target.value = ''; }} />
                  </label>
                  <button onClick={injectMockFiles} style={{ padding: '7px 14px', borderRadius: 8, background: 'white', border: '1px solid #CBD5E1', color: '#475569', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer' }}>
                    🧪 데모 파일
                  </button>
                </div>
              </div>

              <div style={sectionCard}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 'var(--neo-font-size-base)', fontWeight: 800 }}>업로드된 파일 <span style={{ color: '#2A75F3' }}>{files.length}개</span></h3>
                  {files.length > 0 && (
                    <button onClick={resetUploads} style={{ padding: '4px 10px', background: 'white', border: '1px solid #E2E8F0', borderRadius: 6, color: '#94A3B8', fontSize: 'var(--neo-font-size-xs)', cursor: 'pointer' }}>전체 삭제</button>
                  )}
                </div>
                {files.length === 0 ? (
                  <div style={{ padding: '20px 12px', textAlign: 'center', color: '#94A3B8', fontSize: 'var(--neo-font-size-sm)' }}>업로드된 파일이 없습니다.</div>
                ) : (
                  /* [v4.3] 한 줄에 하나씩 쌓지 않고 그리드로 흘린다.
                     24장이면 24줄 → 6줄 정도로 줄어 스크롤과 시각적 부담이 함께 준다. */
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                    {files.map((f) => (
                      <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: '#F8FAFC', border: '1px solid #EEF2F7', borderRadius: 7, fontSize: 'var(--neo-font-size-xs)', minWidth: 0 }}>
                        <span>{f.kind === 'image' ? '🖼' : f.kind === 'pdf' ? '📕' : '📄'}</span>
                        <span style={{ fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }} title={`${f.name} · ${(f.size / 1024).toFixed(0)} KB`}>{f.name}</span>
                        <button onClick={() => setPreviewFileId(f.id)} title="미리보기" style={{ background: 'none', border: 'none', color: '#1D4ED8', cursor: 'pointer', padding: 0, fontSize: 'var(--neo-font-size-xs)' }}>👁</button>
                        <button onClick={() => handleRemoveFile(f.id)} title="삭제" style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: 0, fontSize: 'var(--neo-font-size-xs)' }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* [v4.2] 舊 1단 게이트(대상 학생 확인) 폐기 — 사전 선택 없이 전원 판별, 고지만 남긴다 */}
              {answerStudents.length > 0 && (
                <div style={{ ...sectionCard, borderColor: '#FDBA74', background: '#FFF7ED' }}>
                  <h3 style={{ margin: '0 0 6px', fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#9A3412' }}>
                    📄 이미 답안이 있는 학생 {answerStudents.length}명이 포함되어 있습니다
                  </h3>
                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#9A3412', lineHeight: 1.6, marginBottom: 8 }}>
이 학생들의 <strong>기존 답안은 연결 결과 확인 화면에 답안지 카드로 함께 표시</strong>됩니다.
                    그대로 두면 기존 답안으로 채점되고, 스캔본으로 바꾸려면 그 카드의 <strong>[⋯ → 파일 업로드]</strong>로 교체하세요.
                    교체한 건에 한해 채점 시작 시 한 번 더 확인하며, 기존 답안은 이력에 보관되어 복원할 수 있습니다.
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {answerStudents.map((s) => (
                      <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'white', border: '1px solid #FED7AA', borderRadius: 8, fontSize: 'var(--neo-font-size-sm)' }}>
                        <span style={{ fontWeight: 700, color: '#1E293B' }}>{s.name}</span>
                        <span style={{ color: '#94A3B8', fontSize: 'var(--neo-font-size-xs)' }}>{s.grade || s.class || ''}</span>
                        <span style={{ padding: '1px 8px', borderRadius: 999, background: '#EBF2FF', color: '#2A75F3', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700 }}>답안 있음</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: OCR 판별 ── */}
          {step === 'matching' && (
            <div style={{ ...sectionCard, textAlign: 'center', padding: '48px 24px' }}>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              <div style={{ width: 56, height: 56, margin: '0 auto 16px', border: '5px solid #DBEAFE', borderTopColor: '#2A75F3', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B', marginBottom: 6 }}>답안지를 판별하고 있어요.</div>
              <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>
                각 답안지의 <strong>과제코드 · 학년/반/번호 · 이름 · 문항 번호</strong>를 읽어 학생 명단과 대조하는 중입니다.
              </div>
              <div style={{ marginTop: 18, fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>{files.length}개 파일 처리 중…</div>
            </div>
          )}

          {/* ── Step 3: 연결 결과 확인 ── */}
          {/* [v4.2] 「학생 × 문항」 하나로 고정 (상태별·파일 목록 뷰 삭제).
              구성은 좌우 2단 마스터/디테일:
                · 좌 — 학생 목록. 한 줄에 이름 + 문항별 장수 칩(문항 수만큼). 폭을 좁게 잡아
                       30명이어도 목록 자체만 스크롤된다.
                · 우 — 고른 학생의 답안지 상세. **패널이 따로 스크롤되므로** 학생을 바꿔도
                       화면이 위아래로 튀지 않는다 (기존엔 표 아래에 붙어 있어 30명이면 한참 내려가야 했다).
              상세 카드는 「OCR이 읽은 값(회색·수정 불가)」과 「연결 지정(파랑·수정 가능)」을 나눠 놓는다. */}
          {step === 'review' && (() => {
            const trayKey = 'unassigned';
            // 기본 선택 — 조치가 필요한 곳부터. 미분류 > 문제 있는 학생 > 첫 학생
            const firstBad = targetStudents.find((s) => questionList.some((q) => {
              const sl = slotIndex[slotKey(s.id, q.id)];
              return sl && slotStatus(sl) !== 'ok';
            }));
            const activeKey = selectedKey
              ?? (unassigned.length > 0 ? trayKey : (firstBad?.id ?? targetStudents[0]?.id ?? null));
            const activeStudent = activeKey === trayKey ? null : targetStudents.find((s) => s.id === activeKey);

            // 한 파일의 편집 카드 — 좌: OCR 읽은 값 / 우: 연결 지정
            /**
             * [v4.10] 답안지 작업 공통 메뉴.
             * 구역 순서는 ① 파일 업로드 ② 연결 해제 ③ 미분류 파일 — 자주 쓰는 두 동작을 위로 올리고,
             * 길이가 들쭉날쭉한 미분류 목록을 맨 아래로 내려 버튼 위치가 흔들리지 않게 한다.
             * 팝오버는 **body로 포털**한다. 문항 카드·우측 패널이 overflow를 자르기 때문에
             * 카드 안에 그리면 내용이 잘려 보인다.
             */
            const slotMenu = ({ menuKey, label, row, sl, sheetNo, width, align }) => {
              const inputId = `scan-file-${menuKey}`;
              /* [v4.7] 기존 답안은 **제 자리로만** 돌아간다 — 다른 학생·문항에 붙일 수 있으면
               * 「A 학생의 기존 답안이 B 학생 답안으로 채점되는」 사고가 난다. 목록에서 뺀다.
               * 되돌리기는 미분류 트레이 카드의 [↩ 되돌리기]가 전담한다. */
              const pool = unassigned.filter((u) => u.origin !== 'existing' && (!row || u.fileId !== row.fileId));
              const open = openMenu && openMenu.key === menuKey;
              const close = () => setOpenMenu(null);
              const itemStyle = {
                display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 6,
                border: 'none', background: 'none', cursor: 'pointer',
                fontSize: 'var(--neo-font-size-xs)', color: '#1E293B',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              };
              const dashed = { borderTop: '1px dashed #CBD5E1', margin: '6px 2px' };
              return (
                <span style={{ position: 'relative', display: 'inline-block', width: width || '100%' }}>
                  <button
                    onClick={(e) => {
                      if (open) { close(); return; }
                      const b = e.currentTarget.getBoundingClientRect();
                      setOpenMenu({
                        key: menuKey,
                        top: b.bottom + 4,
                        left: b.left,
                        right: window.innerWidth - b.right,
                      });
                    }}
                    aria-label={row ? `${row.fileName} 답안지 작업` : `${sl.student.name} ${sl.question.title} 답안지 지정`}
                    style={{
                      width: '100%', height: row ? 22 : 26, padding: row ? 0 : '0 8px',
                      textAlign: row ? 'center' : 'left',
                      border: `1px solid ${row ? '#E2E8F0' : '#F59E0B'}`, borderRadius: 6,
                      background: open ? '#F1F5F9' : 'white',
                      color: row ? '#64748B' : '#92400E',
                      fontSize: 'var(--neo-font-size-xs)', fontWeight: row ? 800 : 700, cursor: 'pointer',
                    }}>
                    {label}
                  </button>

                  {open && createPortal(
                    <>
                      {/* 바깥을 누르면 닫힌다 */}
                      <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 9710 }} />
                      <div style={{
                        position: 'fixed', top: openMenu.top,
                        ...(align === 'left' ? { left: openMenu.left } : { right: openMenu.right }),
                        zIndex: 9720, width: 220, maxHeight: '46vh', overflowY: 'auto',
                        background: 'white', border: '1px solid #CBD5E1', borderRadius: 10, padding: 6,
                        boxShadow: '0 10px 24px rgba(15,23,42,0.22)',
                      }}>
                        {/* ① 파일 업로드 */}
                        <button onClick={() => { const el = document.getElementById(inputId); if (el) el.click(); close(); }}
                          style={{ ...itemStyle, background: '#F59E0B', color: 'white', fontWeight: 800, textAlign: 'center' }}>
                          ⬆ 파일 업로드
                        </button>

                        {/* ② 연결 해제 — [v4.7] 기존 답안도 미분류로 내려갈 수 있다.
                            내려가도 사라지지 않고 트레이에서 [↩ 되돌리기]로 제자리에 돌아온다. */}
                        {row && (
                          <>
                            <div style={dashed} />
                            <button onClick={() => { updateAssign(row.fileId, { studentId: null, questionNo: null, sheetNo: null, studentInput: '' }); close(); }}
                              title={row.origin === 'existing' ? '기존 답안을 미분류로 내립니다 — 채점에서 빠지며, 트레이에서 되돌릴 수 있습니다' : undefined}
                              style={{ ...itemStyle, textAlign: 'center', border: '1px solid #FCA5A5', color: '#B91C1C', fontWeight: 800 }}>
                              ✕ 연결 해제
                            </button>
                          </>
                        )}

                        <div style={dashed} />

                        {/* ③ 미분류 파일 */}
                        <div style={{ padding: '0 8px 3px', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#94A3B8' }}>
                          미분류 파일 {pool.length}장
                        </div>
                        {pool.length === 0 ? (
                          <div style={{ padding: '3px 8px', fontSize: 'var(--neo-font-size-xs)', color: '#CBD5E1' }}>없음</div>
                        ) : (
                          pool.map((u) => (
                            <button key={u.fileId} title={u.fileName}
                              onClick={() => { if (row) swapSlotFile(row, u.fileId); else assignFileToSlot(u.fileId, sl, sheetNo); close(); }}
                              style={itemStyle}>
                              {u.fileName}
                            </button>
                          ))
                        )}
                      </div>
                    </>,
                    document.body,
                  )}

                  <input id={inputId} type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
                    aria-label={row ? `${row.fileName} 교체 파일 선택` : `${sl.student.name} ${sl.question.title} 답안지 파일 선택`}
                    onChange={(e) => {
                      if (row) replaceByUpload(e.target.files, row);
                      else addFileToSlot(e.target.files, sl, sheetNo);
                      e.target.value = '';
                    }} />
                </span>
              );
            };
            const fileCard = (r, idx, arr) => {
              const isExisting = r.origin === 'existing';
              const multi = !isExisting && Array.isArray(arr) && arr.length > 1;
              const t = CONFIDENCE_TOKEN[r.confidence] || CONFIDENCE_TOKEN.low;
              const wrongTask = !!r.ocrSheetCode && !sheetCodeSet.has(r.ocrSheetCode);
              const picked = r.studentId != null ? targetStudents.find((s) => s.id === r.studentId) : null;
              const nameText = r.studentInput ?? studentLabel(picked);
              return (
                <div key={r.fileId} style={{ border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', background: 'white' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderBottom: '1px solid #F1F5F9', background: multi ? '#EFF6FF' : 'white' }}>
                    {/* 한 문항에 답안지가 여러 장이면 몇 장째인지 앞에 못박는다 */}
                    {multi && (
                      <span style={{ flex: '0 0 auto', padding: '2px 7px', borderRadius: 6, background: '#2A75F3', color: 'white', fontSize: 'var(--neo-font-size-xs)', fontWeight: 900 }}>
                        {idx + 1}/{arr.length}장
                      </span>
                    )}
                    {/* [v4.4] 기존 답안은 스캔 파일이 아니라 미리보기 대상이 없다 */}
                    {!isExisting && (
                      <button onClick={() => setPreviewFileId(r.fileId)} title="답안지 미리보기" style={{ background: 'white', border: '1px solid #CBD5E1', color: '#1D4ED8', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', padding: '2px 6px', borderRadius: 6, fontWeight: 700 }}>👁</button>
                    )}
                    <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 600, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }} title={r.fileName}>{r.fileName}</span>
                    {/* [v4.4] 기존 답안은 판별을 거치지 않았으므로 신뢰도 배지 대신 출처를 밝힌다 */}
                    {isExisting ? (
                      <span style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 999, background: '#EBF2FF', color: '#2A75F3', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, whiteSpace: 'nowrap' }}>📄 기존 답안</span>
                    ) : r.confidence === 'medium' ? (
                      <label title="확인했으면 체크하세요 — 자동 확정으로 바뀝니다"
                        style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: t.bg, border: `1px solid ${t.color}55`, color: t.color, fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={false} onChange={() => confirmFile(r.fileId)}
                          aria-label={`${r.fileName} 확인 완료`} style={{ margin: 0, cursor: 'pointer' }} />
                        {t.dot} {t.label}
                      </label>
                    ) : (
                      <span style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 999, background: t.bg, color: t.color, fontSize: 'var(--neo-font-size-xs)', fontWeight: 700 }}>{t.dot} {t.label}</span>
                    )}
                    {/* 붙어 있는 장은 공통 메뉴(⋯) — 기존 답안도 같은 메뉴로 스캔본 교체가 된다 [v4.4] */}
                    {r.studentId != null && r.questionNo != null
                      ? slotMenu({ menuKey: `card-${r.fileId}`, label: '⋯', row: r, width: 26 })
                      : isExisting ? (
                        /* [v4.7] 기존 답안은 파일이 아니라 삭제 대상이 아니다. 제자리로 돌리는 것만 가능하다 */
                        <button onClick={() => restoreExisting(r)}
                          title={`${r.fileName}을 원래 문항으로 되돌립니다 — 그 자리의 스캔본은 미분류로 내려갑니다`}
                          style={{ background: 'white', border: '1px solid #2A75F3', color: '#2A75F3', borderRadius: 6, padding: '2px 8px', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          ↩ 되돌리기
                        </button>
                      ) : (
                        <button onClick={() => handleRemoveFile(r.fileId)} title="파일 삭제" style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer' }}>🗑</button>
                      )}
                  </div>

                  {/* [v4.3] OCR 값과 연결 값을 **같은 행에 좌우로** 놓는다.
                      각 열 안에서 이름 → 문항 순서로 세로 배치하므로, 같은 높이에 있는 것끼리
                      바로 대조된다 (왼쪽 이름 ↔ 오른쪽 이름, 왼쪽 문항 ↔ 오른쪽 문항).
                      항목명(학생·/문항·)은 열 제목으로 갈음하고 값에서는 뺐다. */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <div style={{ padding: '6px 8px', background: '#F8FAFC' }}>
                      <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#64748B', marginBottom: 4 }}>{isExisting ? '📄 제출 정보' : '🔍 OCR 판독'}</div>
                      <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#475569', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ height: 26, display: 'flex', alignItems: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={isExisting ? `학생이 ${r.submitPath}로 제출한 답안입니다` : (r.manual ? '교사가 직접 올린 답안지입니다 (OCR 미실행)' : `${r.ocrStudentText || ''} ${r.ocrNameText || ''}`)}>
                          {isExisting
                            ? <span style={{ color: '#1D4ED8', fontWeight: 700 }}>{r.submitPath}</span>
                            : r.manual ? <span style={{ color: '#94A3B8' }}>직접 추가 · OCR 미실행</span> : <>{r.ocrStudentText || '(인식 실패)'} {r.ocrNameText}</>}
                        </div>
                        <div style={{ height: 26, display: 'flex', alignItems: 'center' }}>
                          {isExisting
                            ? <span style={{ color: '#64748B' }}>{r.submittedAt} 제출</span>
                            : r.manual ? <span style={{ color: '#94A3B8' }}>—</span> : <>{ocrQuestionLabel(r)}{r.inferred && <span style={{ color: '#92400E', fontWeight: 700 }}> (AI 추정)</span>}</>}
                        </div>
                      </div>
                      {wrongTask && <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#DC2626', fontWeight: 800, marginTop: 3 }}>⚠ 다른 과제</div>}
                    </div>

                    {/* [v4.2] 학생·문항 수동 지정 폐기 — 확정된 연결을 데이터로만 표시한다.
                        보정이 필요하면 공통 메뉴(⋯)의 [연결 해제] · [미분류 파일] · [파일 업로드]를 쓴다. */}
                    <div style={{ padding: '6px 8px', background: '#F5F9FF', borderLeft: '2px solid #2A75F3' }}>
                      <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#1D4ED8', marginBottom: 4 }}>🔗 연결 결과</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ height: 26, display: 'flex', alignItems: 'center', fontSize: 'var(--neo-font-size-xs)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={nameText}>
                          {picked
                            ? <span style={{ color: '#1E293B', fontWeight: 700 }}>{studentLabel(picked)}</span>
                            : isExisting
                              /* [v4.7] 교체로 내려온 것이라 「판별 실패」와 구분해 적는다 */
                              ? <span style={{ color: '#9A3412', fontWeight: 700 }}>스캔본으로 교체됨</span>
                              : <span style={{ color: '#991B1B', fontWeight: 700 }}>미분류 · 채점 제외</span>}
                        </div>
                        <div style={{ height: 26, display: 'flex', alignItems: 'center', fontSize: 'var(--neo-font-size-xs)' }}>
                          {r.questionNo != null
                            ? <span style={{ color: '#1E293B', fontWeight: 700 }}>
                                {questionOptions().find((op) => op.value === questionValueOf(r))?.label
                                  || questionList.find((q) => q.id === r.questionNo)?.title}
                              </span>
                            : isExisting
                              ? <span style={{ color: '#9A3412' }}>원래 자리 · {questionList.find((q) => q.id === r.homeQuestionNo)?.title}</span>
                              : <span style={{ color: '#94A3B8' }}>(미지정)</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0 }}>
                {/* 요약 한 줄 */}
                <div style={{ ...sectionCard, display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', padding: '10px 16px' }}>
                  <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569' }}>
                    채점 학생 <strong style={{ color: '#1E293B' }}>{targetStudents.length}명</strong>
                  </span>
                  <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569' }}>
                    총 답안지 <strong style={{ color: '#1E293B' }}>{matchResults.length}장</strong>
                  </span>
                  <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569' }}>
                    채점 예정 <strong style={{ color: '#2A75F3' }}>{gradableSlots.length}건</strong>
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 'var(--neo-font-size-xs)', color: '#64748B' }}>
                    기준 {questionList.map((q) => `${q.title} ${q.sheets}장`).join(' · ')} = 1명당 {questionList.reduce((a, q) => a + q.sheets, 0)}장
                  </span>
                </div>

                {/* 학생 이름 직접 입력 후보 (전 행 공용) */}
                <datalist id="scan-student-options">
                  {targetStudents.map((s) => (<option key={s.id} value={studentLabel(s)} />))}
                </datalist>

                {/* 좌: 학생 목록 / 우: 상세 — 각자 스크롤 */}
                <div style={{ display: 'flex', gap: 12, alignItems: 'stretch', flex: 1, minHeight: 260 }}>
                  {/* ── 좌: 학생 × 문항 ── */}
                  <div style={{ flex: '0 0 392px', background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ padding: '8px 12px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <strong style={{ fontSize: 'var(--neo-font-size-sm)', color: '#1E293B' }}>학생 {targetStudents.length}명</strong>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                        {questionList.map((q) => (
                          <span key={q.id}
                            style={{ width: SLOT_CELL_W, textAlign: 'center', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#64748B', whiteSpace: 'nowrap' }}>
                            {q.title.replace(/\s+/g, '')}<span style={{ color: '#2A75F3' }}>({q.sheets}장)</span>
                          </span>
                        ))}
                      </span>
                    </div>

                    <div style={{ flex: 1, overflowY: 'auto' }}>
                      {/* 미분류 트레이 항목 */}
                      {unassigned.length > 0 && (
                        <button onClick={() => setSelectedKey(trayKey)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: 'none', borderBottom: '1px solid #F1F5F9', borderLeft: `3px solid ${activeKey === trayKey ? '#DC2626' : 'transparent'}`, background: activeKey === trayKey ? '#FEF2F2' : 'white', cursor: 'pointer', textAlign: 'left' }}>
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#991B1B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>🔴 미분류</span>
                            {/* [v4.7] 미연결 스캔과 교체된 기존 답안을 한 줄에 나눠 적는다 */}
                            <span title={[unassignedScans.length ? `미연결 스캔 ${unassignedScans.length}장` : null,
                                          replacedExistings.length ? `교체된 기존 답안 ${replacedExistings.length}건` : null]
                                          .filter(Boolean).join(' · ')}
                              style={{ display: 'block', fontSize: 'var(--neo-font-size-xs)', color: '#F87171', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {/* 칸이 좁아 축약한다 — 전체 문구는 title과 우측 패널 머리글에 있다 */}
                              {[unassignedScans.length ? `스캔 ${unassignedScans.length}` : null,
                                replacedExistings.length ? `교체 ${replacedExistings.length}` : null]
                                .filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span style={{ display: 'flex', gap: 4 }}>
                            <span style={{
                              width: questionList.length * SLOT_CELL_W + (questionList.length - 1) * 4,
                              padding: '2px 0', textAlign: 'center', borderRadius: 5,
                              fontSize: 'var(--neo-font-size-xs)', fontWeight: 800,
                              background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#991B1B',
                            }}>
                              {unassigned.length}장
                            </span>
                          </span>
                        </button>
                      )}

                      {targetStudents.map((s) => {
                        const on = activeKey === s.id;
                        return (
                          <button key={s.id} onClick={() => setSelectedKey(s.id)}
                            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: 'none', borderBottom: '1px solid #F1F5F9', borderLeft: `3px solid ${on ? '#2A75F3' : 'transparent'}`, background: on ? '#EFF6FF' : 'white', cursor: 'pointer', textAlign: 'left' }}>
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span style={{ display: 'block', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                              <span style={{ display: 'block', fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.grade || ''}</span>
                            </span>
                            <span style={{ display: 'flex', gap: 4 }}>
                              {questionList.map((q) => {
                                const sl = slotIndex[slotKey(s.id, q.id)];
                                const st = slotStatus(sl);
                                const tok = SLOT_TOKEN[st];
                                const ow = slotReplacedExisting(sl);
                                const check = slotNeedsCheck(sl) || st !== 'ok';
                                // 정상은 ✓로 조용히, 이상(답안지 초과·부족)만 글자로 드러낸다
                                return (
                                  <span key={q.id}
                                    style={{
                                      width: SLOT_CELL_W, padding: '2px 0', textAlign: 'center', borderRadius: 5,
                                      fontSize: 'var(--neo-font-size-xs)', fontWeight: 800,
                                      background: st === 'ok' ? (ow ? '#FFF7ED' : '#F8FAFC') : tok.bg,
                                      border: check ? '2px solid #F59E0B' : `1px solid ${st === 'ok' ? (ow ? '#FDBA74' : '#E2E8F0') : tok.border}`,
                                      color: st === 'ok' ? (ow ? '#9A3412' : '#94A3B8') : tok.color,
                                    }}>
                                    {st === 'ok' ? (ow ? '🔄' : '✓') : tok.label}
                                  </span>
                                );
                              })}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                  </div>

                  {/* ── 우: 상세 ── */}
                  <div style={{ flex: 1, background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                    {activeKey === trayKey ? (
                      <>
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid #E2E8F0', background: '#FEF2F2' }}>
                          <strong style={{ fontSize: 'var(--neo-font-size-base)', color: '#991B1B' }}>🔴 미분류 {unassigned.length}건</strong>
                          <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#991B1B', marginTop: 2 }}>
                            어느 문항에도 붙어 있지 않아 <strong>채점되지 않습니다.</strong> 아래 두 묶음은 성격이 다릅니다.
                          </div>
                        </div>
                        {/* [v4.7] 문항 상세와 같은 열 수·같은 카드 크기로 깔되, **성격이 다른 두 묶음**을 나눠 놓는다.
                            섞어 두면 교체된 기존 답안이 「판별 실패」로 읽혀 교사가 잘못 지정한다. */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
                          {[
                            { key: 'scan', rows: unassignedScans, title: `🔴 미연결 스캔 ${unassignedScans.length}장`, color: '#991B1B',
                              desc: '학생·문항을 판별하지 못했거나, 기존 답안을 되돌리면서 자리에서 내려온 스캔입니다. [👁]로 확인한 뒤 해당 문항의 빈 자리에서 지정해 주세요.' },
                            { key: 'exist', rows: replacedExistings, title: `📄 교체된 기존 답안 ${replacedExistings.length}건`, color: '#9A3412',
                              desc: '스캔본이 그 자리를 대신하고 있습니다. 학생이 낸 답안으로 채점하려면 [↩ 되돌리기]를 누르세요 — 그 자리의 스캔본이 대신 여기로 내려옵니다.' },
                          ].filter((g) => g.rows.length > 0).map((g) => (
                            <div key={g.key}>
                              <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: g.color }}>{g.title}</div>
                              <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', margin: '2px 0 8px', lineHeight: 1.6 }}>{g.desc}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(questionList.length, 3)}, minmax(0, 1fr))`, gap: 10, alignItems: 'start' }}>
                                {g.rows.map(fileCard)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : activeStudent ? (
                      <>
                        <div style={{ padding: '10px 14px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong style={{ fontSize: 'var(--neo-font-size-base)', color: '#1E293B' }}>{activeStudent.name}</strong>
                          <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>{activeStudent.grade || ''}</span>
                          {isAnswerStudent(activeStudent) && (
                            <span style={{ padding: '1px 8px', borderRadius: 999, background: '#EBF2FF', color: '#2A75F3', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700 }}>답안 있음</span>
                          )}
                        </div>

                        {/* [v4.2] 문항을 **가로로** 나란히 놓는다. 문항은 보통 3개 이하이므로
                            폭을 n등분하면 한 학생의 전 문항을 스크롤 없이 한눈에 비교할 수 있다.
                            4개 이상이면 3열을 유지한 채 다음 줄로 넘어간다. */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(questionList.length, 3)}, minmax(0, 1fr))`, gap: 10, alignItems: 'start' }}>
                          {questionList.map((q) => {
                            const sl = slotIndex[slotKey(activeStudent.id, q.id)];
                            const st = slotStatus(sl);
                            const tok = SLOT_TOKEN[st];
                            const ow = slotReplacedExisting(sl);
                            const check = slotNeedsCheck(sl) || st !== 'ok';
                            // 비어 있는 장 번호 — 이미 붙은 장을 빼고 앞에서부터, 모자란 수만큼만
                            const taken = new Set(sl.files.map((f) => f.sheetNo).filter((n) => n != null));
                            const emptySheets = [];
                            // [v4.4] 기존 답안은 「장」 개념이 없으므로 빈 장 자리를 만들지 않는다
                            if (!slotHasExisting(sl)) {
                              for (let pg = 1; pg <= q.sheets && emptySheets.length < q.sheets - sl.files.length; pg += 1) {
                                if (!taken.has(pg)) emptySheets.push(pg);
                              }
                            }
                            return (
                              <div key={q.id} style={{ border: check ? '2px solid #F59E0B' : '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', background: '#FCFDFF' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
                                  <strong style={{ fontSize: 'var(--neo-font-size-sm)', color: '#1E293B' }}>{q.title}</strong>
                                  {/* 정상이면 배지를 달지 않는다 — 손볼 곳만 눈에 띄게 */}
                                  {st !== 'ok' && (
                                    <span style={{ padding: '1px 8px', borderRadius: 999, background: tok.bg, border: `1px solid ${tok.border}`, color: tok.color, fontSize: 'var(--neo-font-size-xs)', fontWeight: 800 }}>
                                      {/* [v4.6] 0장도 `부족 0/2장`으로 장수를 밝힌다 —
                                          舊 `미지정`은 배지만 달고 기준 장수를 숨겼다 */}
                                      {tok.label} {sl.files.length}/{q.sheets}장
                                    </span>
                                  )}
                                  {/* [v4.4] 舊 `기존 답안 교체` 칩 폐기 — 기존 답안이 카드로 직접 보이므로
                                      상태는 카드가 말한다. 여기서는 **교체가 끝난 뒤에만** 결과를 알린다. */}
                                  {ow && (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999, background: '#FFF7ED', border: '1px solid #FDBA74', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#C2410C' }}
                                      title="기존 답안을 스캔본으로 교체했습니다. 채점 시작 시 한 번 더 확인합니다.">
                                      🔄 교체됨
                                    </span>
                                  )}
                                </div>

                                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {sl.files.map(fileCard)}
                                  {/* 기준 장수에 못 미치면 비어 있는 장을 카드 자리로 남겨 둔다.
                                      「몇 장째가 비었나」가 눈에 보이고, 그 자리에서 바로 미분류를 끌어올 수 있다.
                                      0장은 이 빈칸이 기준 장수만큼 생기는 경우일 뿐이다. */}
                                  {emptySheets.map((page) => (
                                    <div key={`empty-${page}`} style={{ padding: '10px', border: '1px dashed #F59E0B', borderRadius: 10, background: '#FFFBEB' }}
                                      onDragOver={(e) => e.preventDefault()}
                                      onDrop={(e) => { e.preventDefault(); addFileToSlot(e.dataTransfer.files, sl, q.sheets > 1 ? page : null); }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                        {q.sheets > 1 && (
                                          <span style={{ padding: '2px 7px', borderRadius: 6, background: '#FDE68A', color: '#92400E', fontSize: 'var(--neo-font-size-xs)', fontWeight: 900 }}>
                                            {page}/{q.sheets}장
                                          </span>
                                        )}
                                        <span style={{ padding: '1px 8px', borderRadius: 999, background: '#FEF3C7', border: '1px solid #F59E0B', color: '#92400E', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800 }}>
                                          확인 필요
                                        </span>
                                      </div>
                                      <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#92400E', marginBottom: 6 }}>
                                        답안지 없음 · 채점 대상 제외
                                      </div>
                                      {/* 붙은 장과 같은 공통 메뉴 — 파일 업로드 / 미분류 파일 구역이 나뉘어 보인다 */}
                                      {slotMenu({
                                        menuKey: `empty-${sl.key}-${page}`,
                                        label: '＋ 답안지 지정…',
                                        align: 'left',
                                        sl,
                                        sheetNo: q.sheets > 1 ? page : null,
                                      })}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94A3B8', fontSize: 'var(--neo-font-size-sm)' }}>
                        왼쪽에서 학생을 선택하세요.
                      </div>
                    )}
                  </div>
                </div>

                {/* 덮어쓰기 안내 */}
                {replacedSlots.length > 0 && (
                  <div style={{ padding: '8px 14px', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 8, fontSize: 'var(--neo-font-size-xs)', color: '#9A3412', lineHeight: 1.6 }}>
                    🔄 <strong>{replacedSlots.length}건</strong>의 기존 답안이 스캔본으로 교체된 상태입니다. 이대로 채점하면 스캔본으로 채점됩니다.
                    밀려난 기존 답안은 <strong>미분류에 그대로 남아 있으며</strong>, 좌측 <strong>[🔴 미분류]</strong>에서 <strong>[↩ 되돌리기]</strong>로 언제든 제자리에 돌릴 수 있습니다. 채점 시작 시 교체 대상을 한 번 더 확인합니다.
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Step 4: 채점 ── */}
          {step === 'grading' && (
            <div style={{ ...sectionCard, textAlign: 'center', padding: '48px 24px' }}>
              <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
              <div style={{ width: 56, height: 56, margin: '0 auto 16px', border: '5px solid #DBEAFE', borderTopColor: '#2A75F3', borderRadius: '50%', animation: gradingFinished ? 'none' : 'spin 1s linear infinite', background: gradingFinished ? '#10B981' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {gradingFinished && <span style={{ color: 'white', fontSize: 24, fontWeight: 900 }}>✓</span>}
              </div>
              <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B', marginBottom: 6 }}>{gradingFinished ? '채점이 완료되었습니다.' : 'AI가 채점하고 있어요.'}</div>
              <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginBottom: 18 }}>
                학생 <strong style={{ color: '#2A75F3' }}>{gradableStudentIds.length}명</strong> · 문항 <strong style={{ color: '#2A75F3' }}>{gradableSlots.length}건</strong>을 채점 중입니다.
                {replacedCount > 0 && <> (기존 답안 교체 <strong style={{ color: '#C2410C' }}>{replacedCount}건</strong> 포함)</>}
              </div>
              <div style={{ width: '80%', margin: '0 auto', height: 8, background: '#E2E8F0', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${gradingProgress}%`, height: '100%', background: '#2A75F3', transition: 'width 0.2s' }} />
              </div>
              <div style={{ marginTop: 8, fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>{gradingProgress}%</div>
            </div>
          )}

          {/* ── Step 5: 완료 ── */}
          {step === 'completed' && (
            <div style={{ ...sectionCard, background: '#F0FDF4', borderColor: '#86EFAC', textAlign: 'center', padding: '32px 24px' }}>
              <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>🎉</div>
              <div style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, color: '#065F46', marginBottom: 8 }}>스캔 일괄 채점이 완료되었습니다.</div>
              <div style={{ fontSize: 'var(--neo-font-size-base)', color: '#047857', marginBottom: 14 }}>
                채점 문항 <strong>{gradableSlots.length}건</strong> · 학생 <strong>{gradableStudentIds.length}명</strong>
                {replacedCount > 0 && <> (기존 답안 교체 <strong>{replacedCount}건</strong> 포함)</>}
              </div>
              {partiallyGradedCount > 0 && (
                <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', maxWidth: 620, margin: '0 auto 10px', lineHeight: 1.6 }}>
                  ⚠ <strong>{partiallyGradedCount}명</strong>은 일부 문항만 채점되어 <strong>미채점 탭에 그대로 남습니다.</strong> 누락된 답안지를 스캔해 다시 실행하면 이어서 채점됩니다.
                </div>
              )}
              {shortGradedCount > 0 && (
                <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#92400E', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: '8px 12px', maxWidth: 620, margin: '0 auto 10px', lineHeight: 1.6 }}>
                  ⚠ <strong>{shortGradedCount}건</strong>은 기준 장수보다 <strong>적은 장수로 채점</strong>되었습니다. 답안지가 빠진 것이라면 해당 문항을 다시 스캔해 채점해 주세요.
                </div>
              )}
              {replacedCount > 0 && (
                <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#9A3412', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 8, padding: '8px 12px', maxWidth: 620, margin: '0 auto 10px' }}>
                  🔄 교체된 학생의 <strong>기존 답안은 이력에 보관</strong>되며, 미채점 상세(SCR-02)에서 확인할 수 있습니다.
                </div>
              )}
              <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#065F46', background: 'white', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 14px', display: 'inline-block' }}>
                [확인]을 누르면 <strong>전 문항이 채점된 {fullyGradedStudentIds.length}명</strong>이 「채점 확인」 단계로 이동합니다.
              </div>
            </div>
          )}
        </div>

        {/* 푸터 */}
        <div style={{ padding: '14px 24px', background: 'white', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>
            {step === 'grading' && '💡 창을 닫아도 채점은 계속 진행되며, 하단 알림으로 다시 열 수 있습니다.'}
            {step === 'review' && startBlocked && (
              <span style={{ color: '#B45309' }}>⚠ {startBlockReason}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step === 'upload' && (
              <>
                <button onClick={handleCloseAttempt} style={{ padding: '9px 18px', borderRadius: 8, background: 'white', border: '1px solid #E2E8F0', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>취소</button>
                <button onClick={startMatching} disabled={!files.length}
                  style={{ padding: '9px 18px', borderRadius: 8, background: files.length ? '#2A75F3' : '#CBD5E1', border: 'none', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: files.length ? 'pointer' : 'not-allowed' }}>
                  🔎 OCR 판별 시작
                </button>
              </>
            )}
            {step === 'review' && (
              <>
                <button onClick={() => { resetUploads(); setStep('upload'); }}
                  title="업로드한 파일과 판별 결과를 모두 비우고 처음부터 다시 선택합니다."
                  style={{ padding: '9px 18px', borderRadius: 8, background: 'white', border: '1px solid #E2E8F0', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>← 파일 다시 선택</button>
                <button onClick={requestGrading} disabled={startBlocked}
                  style={{ padding: '9px 18px', borderRadius: 8, background: startBlocked ? '#CBD5E1' : '#2A75F3', border: 'none', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: startBlocked ? 'not-allowed' : 'pointer' }}
                  title={startBlocked ? startBlockReason : undefined}>
                  🤖 채점 시작
                </button>
              </>
            )}
            {step === 'completed' && (
              <button onClick={handleConfirmComplete} style={{ padding: '9px 22px', borderRadius: 8, background: '#10B981', border: 'none', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-base)', cursor: 'pointer' }}>✓ 확인</button>
            )}
          </div>
        </div>
      </div>

      {/* 파일 미리보기 모달 */}
      {previewFileId != null && (() => {
        const f = files.find((x) => x.id === previewFileId);
        if (!f) return null;
        const r = matchResults.find((x) => x.fileId === previewFileId);
        const t = r ? (CONFIDENCE_TOKEN[r.confidence] || CONFIDENCE_TOKEN.low) : null;
        return (
          <div onClick={(e) => { e.stopPropagation(); setPreviewFileId(null); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.7)', zIndex: 9750, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 960, maxWidth: '94vw', maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ fontSize: '1.2rem' }}>{f.kind === 'image' ? '🖼' : f.kind === 'pdf' ? '📕' : '📄'}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
                    <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span>{(f.size / 1024).toFixed(0)} KB</span>
                      {r && <span style={{ fontFamily: 'monospace' }}>코드 {r.ocrSheetCode || '—'}</span>}
                      {r && <span>{r.ocrStudentText} {r.ocrNameText}</span>}
                      {r && <span>문항 {r.ocrQuestionNo ?? '(미기재)'}</span>}
                      {t && <span style={{ padding: '1px 8px', borderRadius: 999, background: t.bg, color: t.color, fontWeight: 700 }}>{t.dot} {t.label}</span>}
                    </div>
                  </div>
                </div>
                <button onClick={() => setPreviewFileId(null)} aria-label="닫기" style={{ background: 'none', border: 'none', fontSize: '1.3rem', cursor: 'pointer', color: '#64748B', padding: 4 }}>✕</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: '#0F172A', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
                {f.kind === 'image' && f.previewUrl && (
                  <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', maxHeight: '74vh' }}>
                    <img src={f.previewUrl} alt={f.name} style={{ display: 'block', maxWidth: '100%', maxHeight: '74vh', borderRadius: 6 }} />
                    <div title="OCR 판독 영역 (정보 테이블)"
                      style={{ position: 'absolute', top: '6%', left: '4%', right: '4%', height: '18%', border: '2px dashed #FBBF24', background: 'rgba(251, 191, 36, 0.12)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#78350F', background: '#FEF3C7', padding: '1px 6px', borderRadius: 3 }}>OCR 판독 영역 (과제코드 · 학년/반/번호 · 이름 · 문항)</span>
                    </div>
                  </div>
                )}

                {f.kind === 'mock' && (
                  <div style={{ width: 620, maxWidth: '100%', background: 'white', borderRadius: 8, padding: '24px 28px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                    <div style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, color: '#1E3A8A', marginBottom: 12 }}>QiGLE</div>
                    <div style={{ border: '2px dashed #FBBF24', background: 'rgba(251, 191, 36, 0.1)', borderRadius: 4, padding: 8, marginBottom: 12 }}>
                      <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#78350F', fontWeight: 700, marginBottom: 6 }}>OCR 판독 영역</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--neo-font-size-xs)' }}>
                        <tbody>
                          <tr>
                            <td style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', padding: '4px 8px', fontWeight: 700, width: 100 }}>교과/과제명</td>
                            <td colSpan={2} style={{ border: '1px solid #CBD5E1', padding: '4px 8px' }}>{taskTitle}</td>
                            <td style={{ border: '1px solid #CBD5E1', padding: '4px 8px', fontWeight: 800, color: '#1D4ED8' }}>문항 {r?.ocrQuestionNo ?? '__'} 번</td>
                          </tr>
                          <tr>
                            <td style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', padding: '4px 8px', fontWeight: 700 }}>그룹명</td>
                            <td style={{ border: '1px solid #CBD5E1', padding: '4px 8px' }}>{groupLabel}</td>
                            <td style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', padding: '4px 8px', fontWeight: 700 }}>답안지코드</td>
                            <td style={{ border: '1px solid #CBD5E1', padding: '4px 8px', fontFamily: 'monospace' }}>{r?.ocrSheetCode || taskCode}</td>
                          </tr>
                          <tr>
                            <td style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', padding: '4px 8px', fontWeight: 700 }}>학년/반/번호</td>
                            <td style={{ border: '1px solid #CBD5E1', padding: '4px 8px' }}>{r?.ocrStudentText || '(   )학년 (   )반 (   )번'}</td>
                            <td style={{ background: '#F8FAFC', border: '1px solid #CBD5E1', padding: '4px 8px', fontWeight: 700 }}>이름</td>
                            <td style={{ border: '1px solid #CBD5E1', padding: '4px 8px' }}>{r?.ocrNameText || ''}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div style={{ border: '1px solid #CBD5E1', padding: '14px 12px', minHeight: 240 }}>
                      {Array.from({ length: 10 }, (_, i) => (<div key={i} style={{ height: 22, borderBottom: '1px solid #CBD5E1' }} />))}
                    </div>
                    <div style={{ marginTop: 12, textAlign: 'center', fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>
                      · 데모 파일 mock 프리뷰. 실제 스캔본은 이미지·PDF로 렌더됩니다.
                    </div>
                  </div>
                )}

                {f.kind === 'pdf' && (
                  <div style={{ background: 'white', borderRadius: 8, padding: '48px 32px', textAlign: 'center', maxWidth: 400 }}>
                    <div style={{ fontSize: '3rem', marginBottom: 12 }}>📕</div>
                    <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B', marginBottom: 6 }}>PDF 미리보기</div>
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', lineHeight: 1.6 }}>
                      PDF 페이지 렌더링은 <strong>준비 중</strong>입니다. 파일 자체는 채점 대상에 정상 포함됩니다.
                    </div>
                  </div>
                )}

                {!['image', 'mock', 'pdf'].includes(f.kind) && (
                  <div style={{ background: 'white', borderRadius: 8, padding: '48px 32px', textAlign: 'center', maxWidth: 400 }}>
                    <div style={{ fontSize: '3rem', marginBottom: 12 }}>❓</div>
                    <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>미지원 형식</div>
                  </div>
                )}
              </div>

              {/* 리뷰 단계에서는 팝업에서 바로 학생·문항 지정 */}
              {step === 'review' && r && (
                <div style={{ padding: '12px 20px', borderTop: '1px solid #E2E8F0', background: '#F8FAFC', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 700 }}>이 답안지의 학생·문항</span>
                  <select value={r.studentId ?? ''} onChange={(e) => updateAssign(r.fileId, { studentId: e.target.value ? Number(e.target.value) : null })}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 'var(--neo-font-size-sm)', background: 'white', minWidth: 200 }}>
                    <option value="">학생 선택</option>
                    {targetStudents.map((s) => (<option key={s.id} value={s.id}>{s.name} ({s.grade || ''})</option>))}
                  </select>
                  <select value={r.questionNo ?? ''} onChange={(e) => updateAssign(r.fileId, { questionNo: e.target.value ? Number(e.target.value) : null })}
                    style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #CBD5E1', fontSize: 'var(--neo-font-size-sm)', background: 'white', minWidth: 120 }}>
                    <option value="">문항 선택</option>
                    {questionList.map((q) => (<option key={q.id} value={q.id}>{q.title} ({questionOrder(q)}/{questionList.length}번째)</option>))}
                  </select>
                  <button onClick={() => setPreviewFileId(null)} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, background: '#2A75F3', border: 'none', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>적용 후 닫기</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* [v4.7] 판별 직후 교체 의사 확인 — 전체 스캔으로 기존 답안이 밀려났을 때 1회.
          판별 **결과를 보여준 뒤** 묻는다. 차단이 아니라 기본값(스캔본)을 그대로 둘지 묻는 것이고,
          여기서 못 정해도 미분류 트레이에서 건별로 언제든 되돌릴 수 있다. */}
      {confirmReplace && replacedExistings.length > 0 && (
        <div onClick={(e) => { e.stopPropagation(); setConfirmReplace(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 9800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 520, maxWidth: '94vw', padding: '20px 22px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, color: '#9A3412' }}>🔄 이미 답안이 있는 학생이 있습니다</h3>
            {/* 건수가 아니라 **학생 수**로 센다 — 교사가 판단하는 단위는 「누구의 답안을 바꾸나」다 */}
            <p style={{ margin: '0 0 12px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.7 }}>
              스캔본 내용 중 <strong style={{ color: '#C2410C' }}>{replacedStudentNames.length}명</strong>의 학생이 이미 제출한 답안파일이 있습니다.
            </p>
            <div style={{ padding: '8px 12px', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 8, fontSize: 'var(--neo-font-size-sm)', color: '#9A3412', marginBottom: 14, lineHeight: 1.6, maxHeight: 120, overflowY: 'auto' }}>
              대상 : {replacedStudentNames.join(', ')}
            </div>
            <p style={{ margin: '0 0 16px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.7 }}>
              어느 쪽을 선택해도 나머지 답안은 <strong>미분류로 남아</strong> 채점 전까지 변경할 수 있습니다.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => { restoreAllExisting(); setConfirmReplace(false); }}
                style={{ padding: '9px 16px', borderRadius: 8, background: 'white', border: '1px solid #CBD5E1', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>
                기존 답안으로 채점
              </button>
              <button onClick={() => setConfirmReplace(false)}
                style={{ padding: '9px 16px', borderRadius: 8, background: '#EA580C', border: 'none', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>
                스캔파일로 교체
              </button>
            </div>
          </div>
        </div>
      )}

      {/* [v4.4] 실행 직전 게이트 — 교체한 건에 대해서만 확인 */}
      {confirmOverwrite && (
        <div onClick={(e) => { e.stopPropagation(); setConfirmOverwrite(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 9800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 460, maxWidth: '94vw', padding: '20px 22px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, color: '#9A3412' }}>🔄 기존 답안을 교체합니다</h3>
            <p style={{ margin: '0 0 12px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.7 }}>
              학생이 제출한 답안 <strong style={{ color: '#C2410C' }}>{replacedCount}건</strong>이 스캔본으로 교체됩니다.<br />
              기존 답안은 이력에 보관되며 복원할 수 있습니다.<br />
              계속하시겠습니까?
            </p>
            <div style={{ padding: '8px 12px', background: '#FFF7ED', border: '1px solid #FDBA74', borderRadius: 8, fontSize: 'var(--neo-font-size-xs)', color: '#9A3412', marginBottom: 14, lineHeight: 1.6 }}>
              교체 대상: {gradableSlots.filter(slotReplacedExisting).map((sl) => `${sl.student.name} ${sl.question.title}`).join(', ')}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmOverwrite(false)} style={{ padding: '8px 16px', borderRadius: 8, background: 'white', border: '1px solid #E2E8F0', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>취소</button>
              <button onClick={startGrading} style={{ padding: '8px 18px', borderRadius: 8, background: '#EA580C', border: 'none', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>덮어쓰고 채점 시작</button>
            </div>
          </div>
        </div>
      )}

      {/* 종료 확인 */}
      {confirmClose && (
        <div onClick={(e) => { e.stopPropagation(); setConfirmClose(false); }} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 9800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 420, padding: '20px 22px', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>지금 닫으시겠습니까?</h3>
            <p style={{ margin: '0 0 14px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.6 }}>
              {step === 'grading' ? '채점이 진행 중입니다. 지금 닫으면 결과가 유실됩니다.' : '진행 중인 판별·검토가 초기화됩니다. 다시 파일을 업로드해야 합니다.'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmClose(false)} style={{ padding: '8px 16px', borderRadius: 8, background: 'white', border: '1px solid #E2E8F0', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>계속 진행</button>
              <button onClick={forceClose} style={{ padding: '8px 18px', borderRadius: 8, background: '#EF4444', border: 'none', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScanGradingModal;
