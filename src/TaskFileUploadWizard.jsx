/**
 * TaskFileUploadWizard.jsx
 * TSK-12 — 파일 업로드 과제 등록 Wizard (PRD v1.1)
 * Step 1 → 2 전환 시 OCR 자동 감지 프로세스 (§3.3, stub 구현 — 실제 OCR API 미연동)
 *
 * Prototype level. PoC Field Editor 패턴 기반:
 *   - 캔버스 위에 SVG 오버레이로 영역 사각형 정의
 *   - 사용 타입: question(문항, 필수) · passage(지문, 선택 — 시각만)
 *   - 자동 감지 영역은 autoDetected: true 플래그 + 🤖 배지로 표시. 편집 시 false 전환
 */
import React, { useState, useRef, useEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import {
  AUTO_SCALES, AUTO_LEVELS, RUBRIC_CATEGORIES, RUBRIC_TEMPLATE, stdCode, GRADE_CUTOFFS, GRADE_NAMES,
  clampLevels, maxIntervalFor, defaultInterval, buildScoreRows, rowsDescending, makeCriterion, scoreToGrade,
  subjectsOf, gradesOf, competenciesOf, evalAreasOf,
} from './lib/gradingShared';
import { buildFileUploadTask } from './lib/taskSchema';
import WorksheetPreviewModal from './WorksheetPreviewModal';
import NumberTagPreviewModal from './NumberTagPreviewModal';
// Vite-friendly worker URL (CDN fallback). pdfjs-dist v5+ uses .mjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// 영역 타입 — 문항(question, 필수) + 지문(passage, 자동 감지 ✓ · 시각 컨텍스트 · 펜 입력 불가) + 이미지(image, 겹침 허용 · 좌표 그대로 crop)
// PRD §3.5 — 답안·반·번호 영역은 미사용
// [v2.66] 이미지 타입 신규 — overlapAllowed: true. 지문·문항 안에 이미지 영역을 두면
//         해당 좌표만 이미지로 크롭 추출, 나머지는 OCR 처리됨. 이미지끼리도 겹침 허용
const AREA_TYPES = [
  { id: 'question', label: '문항', color: '#2A75F3', icon: '🟦', fill: 'rgba(42,117,243,0.08)', stroke: '#2A75F3' },
  { id: 'passage',  label: '지문', color: '#94A3B8', icon: '🟫', fill: 'rgba(148,163,184,0.05)', stroke: '#94A3B8' },
  { id: 'image',    label: '이미지', color: '#F59E0B', icon: '🟨', fill: 'rgba(245,158,11,0.10)', stroke: '#F59E0B', overlapAllowed: true },
];

const STEPS = [
  { n: 1, label: '기본 정보·파일 업로드', icon: '📋' },
  { n: 2, label: '영역 편집',             icon: '🎯' },
  { n: 3, label: '문항 입력',             icon: '📝' },
  { n: 4, label: '성취기준',              icon: '✅' },
  { n: 5, label: '평가 방식·채점 기준',   icon: '⚖️' },
  { n: 6, label: '그룹 배포·출력',        icon: '🚀' },
];

// mock — 그룹 list (TSK-05 패턴)
const MOCK_GROUPS = [
  { id: 'g1', name: '1학년 1반', studentCount: 28 },
  { id: 'g2', name: '1학년 2반', studentCount: 27 },
  { id: 'g3', name: '2학년 1반', studentCount: 26 },
  { id: 'g4', name: '2학년 2반', studentCount: 27 },
];

const CANVAS_W = 700;
const CANVAS_H = 990; // A4 비율

const TaskFileUploadWizard = ({ onBack, showToast, onAdd }) => {
  const [step, setStep] = useState(1);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [areas, setAreas] = useState([]);
  const [activeAreaType, setActiveAreaType] = useState('question');
  const [selectedAreaId, setSelectedAreaId] = useState(null);
  const [worksheetPreviewOpen, setWorksheetPreviewOpen] = useState(false); // [TSK-05 v2.30] 평가 답안지 미리보기 모달
  const [numberTagPreviewOpen, setNumberTagPreviewOpen] = useState(false); // [TSK-05 v3.4] 스마트펜 번호표 미리보기 모달
  const [basicInfo, setBasicInfo] = useState({
    title: '',
    type: '서술형',
    subject: '국어',          // 교과
    subSubject: '공통국어1',  // 과목 (교과 종속)
    schoolLevel: '중학교',
    grade: '1~3학년',         // 학년군 (학교급 종속)
    competencies: [],         // 핵심 역량 (다중)
    // [v2.7] evaluationAreas는 questions[].evaluationAreas로 이관 — 문항별 독립 관리
  });
  // 답안 영역별 정답·배점 (key = area.id)
  const [answerDetails, setAnswerDetails] = useState({});
  // [v2.2] 사이드바 영역 이름 인라인 편집 — id, 입력값
  const [editingAreaNameId, setEditingAreaNameId] = useState(null);
  const [editingAreaNameValue, setEditingAreaNameValue] = useState('');
  // 평가지표
  const [rubricMode, setRubricMode] = useState('auto'); // 'auto' | 'manual'
  const [rubricManualText, setRubricManualText] = useState('');
  // 그룹 배포 상태
  // 그룹 배포 — 그룹별 번호표/학생 배포 (TSK-13 동일)
  const [groupList, setGroupList] = useState(MOCK_GROUPS.map((g) => ({ id: g.id, label: g.name, studentCount: g.studentCount, codeDeployed: false, studentDeployed: false })));
  // [v2.55] 학생 1명당 인쇄할 답안지 수 — 기본 1, 범위 1~10 (v2.57: 호환용 유지)
  const [answerSheetCopies, setAnswerSheetCopies] = useState(1);
  // [v2.57] 문항별 답안지 수 매핑 — { [qid]: number }, 기본 1
  const [copiesPerQuestion, setCopiesPerQuestion] = useState({});
  const getCopies = (qid) => copiesPerQuestion[qid] ?? 1;
  const setCopies = (qid, n) => setCopiesPerQuestion((p) => ({ ...p, [qid]: Math.max(1, Math.min(10, n)) }));
  // [v2.63] totalCopies는 questions state 정의 이후로 이동 (TDZ 회피)
  const printableGroups = groupList.filter((g) => g.codeDeployed); // 번호표 배포된 그룹 = 출력 대상
  // [v2.28] 번호표 인쇄 한도 = 3페이지 × 39명 = 117명. 초과 그룹은 배포 차단
  const TAG_PRINT_LIMIT = 117;
  const toggleGroupCode = (gid) => setGroupList((prev) => prev.map((g) => {
    if (g.id !== gid) return g;
    if (!g.codeDeployed) {
      if (g.studentCount > TAG_PRINT_LIMIT) {
        showToast && showToast(`「${g.label}」(${g.studentCount}명)은 번호표 인쇄 한도(${TAG_PRINT_LIMIT}명)를 초과하여 배포할 수 없습니다. 그룹을 분할해 주세요.`);
        return g;
      }
      showToast && showToast(`「${g.label}」 번호표 배포 (과제 할당 · 채점 관리 미채점)`);
      return { ...g, codeDeployed: true };
    }
    if (g.studentDeployed) { showToast && showToast('학생 배포 중인 그룹은 번호표 배포를 취소할 수 없습니다. 먼저 학생 배포를 취소하세요.'); return g; }
    showToast && showToast(`「${g.label}」 번호표 배포 취소 (과제 할당 해제)`); return { ...g, codeDeployed: false };
  }));
  const toggleGroupStudent = (gid) => setGroupList((prev) => prev.map((g) => {
    if (g.id !== gid) return g;
    if (!g.studentDeployed) {
      if (g.studentCount > TAG_PRINT_LIMIT) {
        showToast && showToast(`「${g.label}」(${g.studentCount}명)은 번호표 인쇄 한도(${TAG_PRINT_LIMIT}명)를 초과하여 배포할 수 없습니다. 그룹을 분할해 주세요.`);
        return g;
      }
      showToast && showToast(`「${g.label}」 학생 배포`);
      return { ...g, codeDeployed: true, studentDeployed: true };
    }
    showToast && showToast(`「${g.label}」 학생 배포 취소`); return { ...g, studentDeployed: false };
  }));

  // ── [TSK-13 동일] 평가 방식·채점 기준 상태 ───────────────────────────
  const [questions, setQuestions] = useState([]); // 문제(question) 영역에서 파생된 문항
  // [v2.63] questions 정의 이후로 totalCopies 이동 — TDZ 에러 회피
  const totalCopies = questions.reduce((s, q) => s + getCopies(q.id), 0);
  const [evalMode, setEvalMode] = useState('auto'); // 'auto' | 'self'
  const [autoScale, setAutoScale] = useState(3);     // 자동평가 채점 단계(3/5)
  const [rubricOverrides, setRubricOverrides] = useState({}); // `${qid}|${sid}|${cat}|${lv}` → text
  const [resultScale, setResultScale] = useState(3);
  const [selfScale, setSelfScale] = useState(3); // [v3.47] 자율평가 단계 — 모든 채점기준 levels + 등급 환산 일괄 동기화
  const [demoScore, setDemoScore] = useState('');
  const [gradePreviewOpen, setGradePreviewOpen] = useState(false);
  const [stdOpen, setStdOpen] = useState({}); // 문항별 성취기준 목록 펼침 상태 { [qid]: bool }
  // [v2.47] 자동평가 채점 기준표 영역 — 다중 standards 시 현재 보고 있는 sid 추적 { [qid]: sid }
  const [activeRubricStdMap, setActiveRubricStdMap] = useState({});
  // [v2.47] 자율평가 등급 환산 미리보기 — 우측 fixed 패널 펼침/숨김 (기본 펼침)
  const [previewExpanded, setPreviewExpanded] = useState(true);
  // [v2.61] 한 배너 통합 — 활용(좌) + 주의(우) 비대칭 분할. warnExpanded=true 시 주의가 큰 영역(4/5), false 시 활용이 큰 영역(4/5)
  const [warnExpanded, setWarnExpanded] = useState(false);
  const [taskStdOpen, setTaskStdOpen] = useState(false); // [v3.46] 과제 단위 성취기준 펼침 상태
  const [modelAnsOpen, setModelAnsOpen] = useState({}); // 문항별 모범답안 펼침 { [qid]: bool } — 미지정 시 펼침
  const toggleModelAns = (qid) => setModelAnsOpen((p) => ({ ...p, [qid]: !(p[qid] ?? true) }));
  const [modelAnsFocused, setModelAnsFocused] = useState(false); // [v2.70] 활성 문항 모범답안 textarea focus — 오버레이 자동 숨김
  const [activeQId, setActiveQId] = useState(null); // Step 3 문항 확인 탭 — 현재 선택된 문항 id
  // 원본 이미지 플로팅 창 — 본문 입력 중에도 떠 있고, 이동·크기조절 가능. 닫기 버튼으로만 닫힘
  const [imgWin, setImgWin] = useState(null); // { qid, label, idx, src }
  const [winPos, setWinPos] = useState({ x: 0, y: 0 });
  const winDragRef = useRef(null);
  const openOriginalImage = (qid) => {
    const area = areas.find((a) => a.id === qid && a.type === 'question');
    const rect = area?.rect;
    // [v2.73] 영역이 속한 페이지의 dataUrl을 사용
    const areaPage = area?.page || 1;
    const pageData = uploadedFile?.pages?.[areaPage - 1];
    if (!pageData?.dataUrl || !rect) return;
    const idx = questions.findIndex((q) => q.id === qid);
    const img = new Image();
    img.onload = () => {
      // 업로드 원본에서 해당 문제 영역만 잘라 별도 이미지로 — 창 크기조절 시 자연스럽게 스케일
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(rect.w));
      c.height = Math.max(1, Math.round(rect.h));
      const ctx = c.getContext('2d');
      ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
      setImgWin({ qid, label: area.name, idx, src: c.toDataURL('image/png') });
      setWinPos({ x: Math.max(16, window.innerWidth - 440), y: 140 });
    };
    img.src = pageData.dataUrl;
  };
  const startWinDrag = (e) => {
    e.preventDefault();
    winDragRef.current = { offX: e.clientX - winPos.x, offY: e.clientY - winPos.y };
    const onMove = (ev) => {
      const d = winDragRef.current; if (!d) return;
      setWinPos({ x: ev.clientX - d.offX, y: ev.clientY - d.offY });
    };
    const onUp = () => {
      winDragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // 문제(question) 영역 수 = 문항 수. 영역 추가/삭제 시 동기화(작성한 배점·채점기준은 보존)
  // 새 문제 영역이 생기면 OCR 자동 인식 결과를 본문 편집기에 자동 반영 (현재 stub — 실제 OCR 연동 시 영역 이미지에서 텍스트 추출)
  const OCR_STUB_SAMPLES = [
    '다음 글을 읽고 물음에 답하시오.\n\n글쓴이는 대화에서 상대의 말을 끝까지 듣는 태도가 공동체의 신뢰를 형성한다고 주장한다. 이러한 주장에 대한 자신의 견해를, 글에 제시된 사례를 1개 이상 인용하여 근거와 함께 서술하시오.',
    '위 글에서 글쓴이가 제시한 주요 사례를 정리하고, 각 사례가 주장과 어떻게 연결되는지 설명하시오.',
    '글의 결론과 관련하여, 일상 속에서 실천할 수 있는 방안 한 가지를 제시하고 그 이유를 서술하시오.',
  ];
  useEffect(() => {
    setQuestions((prev) => {
      const byId = Object.fromEntries(prev.map((q) => [q.id, q]));
      // [v2.74] 묶음 단위로 문항 파생 — 같은 group.id 영역들은 1 문항으로 합쳐짐
      //   question id = group.id가 있으면 group.id, 없으면 영역 id
      //   content는 묶음 안 ocrText를 partIndex 순으로 이어붙임 (구분자: [다음 페이지로 이어짐])
      const questionAreas = areas.filter((a) => a.type === 'question');
      const questionGroups = computeAreaGroups(questionAreas);
      return questionGroups.map((g, i) => {
        const firstArea = g.firstArea;
        const qid = g.groupId || firstArea.id;
        const ex = byId[qid];
        if (ex) return { ...ex, label: `문항 ${i + 1}` };
        // 새 문항 — content는 묶음 통합 OCR 텍스트
        const autoContent = g.groupId
          ? joinedGroupOcrText(g.groupId)
          : (firstArea.ocrText || OCR_STUB_SAMPLES[i % OCR_STUB_SAMPLES.length]);
        return { id: qid, label: `문항 ${i + 1}`, content: autoContent, evaluationAreas: [], modelAnswer: { html: '' }, standard: '', standards: [], points: '', criteria: [makeCriterion()] };
      });
    });
  }, [areas]);

  const totalPoints = evalMode === 'auto'
    ? questions.reduce((s, q) => s + (Number(q.points) || 0), 0)
    : questions.reduce((s, q) => s + q.criteria.reduce((cs, c) => cs + (Number(c.maxPoints) || 0), 0), 0);

  const updateQuestion = (qid, patch) => setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, ...patch } : q)));

  // [v2.34] 다중 성취기준 토글 — 체크박스 다중 선택 정책
  //   - standards 배열에 sid를 토글(추가/제거)
  //   - standard(단수)는 standards[0]과 동기화 (기존 로직 호환)
  //   - evaluationAreas: 선택된 standards의 영역들의 합집합으로 자동 갱신
  //   - v2.34 이전: 「성취기준 1개 = 영역 1개 매핑」 정책 → 다중 선택 정책으로 확장
  const selectQuestionStandard = (qid, sid) => {
    // [v2.38] 트리거 결정을 setQuestions 외부로 이동 — React 19에서 콜백 내부 외부 변수 mutate가 의도대로 동작 안 함
    const q = questions.find((x) => x.id === qid);
    if (!q) return;
    const current = q.standards || (q.standard ? [q.standard] : []);
    const has = current.includes(sid);
    // [v2.67] 최대 3개 제한 — 4번째 추가 시도 시 토스트 + return
    if (!has && current.length >= 3) {
      showToast && showToast('성취기준은 문항당 최대 3개까지 선택할 수 있습니다.');
      return;
    }
    const nextStandards = has ? current.filter((s) => s !== sid) : [...current, sid];
    // [v2.61] 1 → 2 전환 순간 모달 대신 배너 주의 영역 자동 펼침
    if (current.length === 1 && nextStandards.length === 2) {
      setWarnExpanded(true);
    }
    setQuestions((qs) => qs.map((x) => {
      if (x.id !== qid) return x;
      const nextAreas = Array.from(new Set(nextStandards
        .map((id) => MOCK_STANDARDS.find((y) => y.id === id)?.area)
        .filter(Boolean)));
      return {
        ...x,
        standards: nextStandards,
        standard: nextStandards[0] || '',
        evaluationAreas: nextStandards.length > 0 ? nextAreas : x.evaluationAreas,
      };
    }));
  };

  // [v2.71] 문항별 모범답안 — contenteditable HTML 단일 필드 (텍스트 + 이미지 inline)
  // 합계 10MB 정책: 첨부 base64 이미지 총합이 10MB 초과 시 추가 차단
  const MAX_MODEL_ANSWER_IMAGES_BYTES = 10 * 1024 * 1024;
  // 마이그레이션 — 舊 { text, images } / 舊舊 { 상,중,하 } → 새 { html } 자동 변환
  const getModelAnswer = (q) => {
    if (!q) return { html: '' };
    if (q.modelAnswer && q.modelAnswer.html !== undefined) return q.modelAnswer;
    if (q.modelAnswer && (q.modelAnswer.text !== undefined || q.modelAnswer.images)) {
      let html = '';
      const text = q.modelAnswer.text || '';
      if (text) html += text.split('\n').map((line) => `<div>${line || '<br>'}</div>`).join('');
      (q.modelAnswer.images || []).forEach((img) => {
        html += `<img src="${img.src}" style="max-width:100%;display:block;margin:8px 0;" />`;
      });
      return { html };
    }
    if (q.modelAnswers) {
      let html = '';
      ['상', '중', '하'].forEach((lv) => {
        if (q.modelAnswers[lv]) html += `<div><strong>[${lv}]</strong> ${q.modelAnswers[lv]}</div>`;
      });
      return { html };
    }
    return { html: '' };
  };
  const isModelAnswerFilled = (q) => {
    const html = getModelAnswer(q).html || '';
    const stripped = html.replace(/<[^>]+>/g, '').trim();
    const hasImg = /<img\b/i.test(html);
    return !!(stripped || hasImg);
  };
  const updateModelAnswerHtml = (qid, html) =>
    setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, modelAnswer: { html } } : q)));
  const clearModelAnswer = (qid) =>
    setQuestions((qs) => qs.map((q) => (q.id === qid ? { ...q, modelAnswer: { html: '' } } : q)));
  // HTML 내 base64 이미지 총 바이트 계산 (근사: base64 길이 × 0.75)
  const getImageTotalBytes = (html) => {
    if (!html) return 0;
    let total = 0;
    const re = /<img\s+[^>]*src="data:image\/[^;]+;base64,([^"]+)"/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      total += Math.floor(m[1].length * 0.75);
    }
    return total;
  };
  // 가드 — 추가 후 합계 검증
  const canAddImage = (currentHtml, dataUrl) => {
    const base64 = (dataUrl.split(',')[1] || '');
    const additionBytes = Math.floor(base64.length * 0.75);
    const currentBytes = getImageTotalBytes(currentHtml);
    if (currentBytes + additionBytes > MAX_MODEL_ANSWER_IMAGES_BYTES) {
      const remainMB = Math.max(0, (MAX_MODEL_ANSWER_IMAGES_BYTES - currentBytes) / 1024 / 1024);
      showToast && showToast(`첨부 이미지 합계가 10MB를 초과합니다. (현재 ${(currentBytes / 1024 / 1024).toFixed(1)}MB · 추가 가능 ${remainMB.toFixed(1)}MB)`);
      return false;
    }
    return true;
  };
  // contenteditable 안에 현재 cursor 위치로 이미지 삽입 (DOM 직접 조작)
  const insertImageIntoEditor = (editor, dataUrl) => {
    if (!editor) return false;
    if (!canAddImage(editor.innerHTML, dataUrl)) return false;
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.maxWidth = '100%';
    img.style.display = 'block';
    img.style.margin = '8px 0';
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(img);
      range.setStartAfter(img);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(img);
    }
    return true;
  };
  // contenteditable onPaste — 클립보드 이미지/텍스트 inline 삽입
  const handleModelAnswerPaste = (e, qid) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageItems = Array.from(items).filter((it) => it.type && it.type.indexOf('image') !== -1);
    if (imageItems.length === 0) return; // 텍스트 paste는 기본 동작
    e.preventDefault();
    const editor = e.currentTarget;
    imageItems.forEach((item) => {
      const blob = item.getAsFile();
      if (!blob) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (insertImageIntoEditor(editor, ev.target.result)) {
          updateModelAnswerHtml(qid, editor.innerHTML);
        }
      };
      reader.readAsDataURL(blob);
    });
  };
  // 파일 input → 다중 이미지 inline 삽입
  const onModelAnswerFiles = (qid, fileList) => {
    const editor = document.querySelector(`[data-model-answer-editor="${qid}"]`);
    if (!editor) return;
    Array.from(fileList || []).forEach((f) => {
      if (!f.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        if (insertImageIntoEditor(editor, ev.target.result)) {
          updateModelAnswerHtml(qid, editor.innerHTML);
        }
      };
      reader.readAsDataURL(f);
    });
  };
  // [정책] html에 텍스트/이미지 비어 있을 때만 stub 채움
  const generateModelAnswers = (qid) => {
    const q = questions.find((x) => x.id === qid);
    if (!q || !q.content.trim()) { showToast && showToast('모범답안 생성을 위해 문항 내용을 먼저 입력해 주세요.'); return; }
    if (isModelAnswerFilled(q)) { showToast && showToast('모범답안이 이미 입력되어 있습니다. ✕ 비우기 후 다시 실행하세요.'); return; }
    const sample = '<div>문항 요구를 정확히 충족하고 핵심 개념을 통합적으로 적용하며, 논리·근거·표현이 명확한 모범답안 예시입니다. (성취기준 기반 stub — 실연동 시 LLM 호출)</div>';
    updateModelAnswerHtml(qid, sample);
    showToast && showToast('AI 모범답안을 생성했습니다. (성취기준 기반 — 검토·수정하세요)');
  };
  const rubricCell = (qid, sid, catKey, lvIdx, scale) => {
    const k = `${qid}|${sid}|${catKey}|${lvIdx}`;
    if (k in rubricOverrides) return rubricOverrides[k];
    return RUBRIC_TEMPLATE[catKey]?.[scale]?.[lvIdx] || '';
  };
  const setRubricCell = (qid, sid, catKey, lvIdx, text) => setRubricOverrides((p) => ({ ...p, [`${qid}|${sid}|${catKey}|${lvIdx}`]: text }));
  // [정책] 채점 기준표 재생성 — 빈 칸만 템플릿으로 채우고 수동 수정 보존. 재생성하려면 ✕로 비운 뒤 호출.
  const regenerateRubric = (qid, sid, scale) => {
    if (!sid) { showToast && showToast('이 문항의 성취기준을 먼저 선택해 주세요.'); return; }
    let filled = 0, skipped = 0;
    setRubricOverrides((p) => {
      const next = { ...p };
      RUBRIC_CATEGORIES.forEach((cat) => {
        for (let lvIdx = 0; lvIdx < scale; lvIdx++) {
          const k = `${qid}|${sid}|${cat.key}|${lvIdx}`;
          const cur = k in next ? next[k] : (RUBRIC_TEMPLATE[cat.key]?.[scale]?.[lvIdx] || '');
          if (cur && cur.trim()) { skipped++; continue; }
          const tpl = RUBRIC_TEMPLATE[cat.key]?.[scale]?.[lvIdx] || '';
          if (tpl) { next[k] = tpl; filled++; }
        }
      });
      return next;
    });
    if (filled === 0) showToast && showToast('빈 칸이 없습니다. ✕ 버튼으로 칸을 비운 뒤 다시 실행하세요.');
    else showToast && showToast(`빈 칸 ${filled}개를 템플릿으로 채웠습니다. 수동 수정한 ${skipped}개 칸은 보존됨.`);
  };
  const clearRubricCell = (qid, sid, catKey, lvIdx) => setRubricOverrides((p) => ({ ...p, [`${qid}|${sid}|${catKey}|${lvIdx}`]: '' }));

  // [정책] 자율평가 — q.points(총 배점) 입력 시 채점기준 추가/재분배에 사용. 미입력 시 makeCriterion 기본값.
  const rebuildCriterionForMaxPoints = (c, mp) => {
    const M = mp;
    // [v3.73] 총 배점 재분배도 단계 수는 유지한다 — 배점만 바뀌고 입력 구간·평가 내용은 그대로
    const levels = Math.max(2, c.levels || 2);
    // 배점이 아직 2점 미만인 「입력 중」 상태에서는 간격도 건드리지 않는다 (배점을 되돌리면 원래 점수 배열로 복귀)
    const interval = M >= 2
      ? Math.max(1, Math.min(maxIntervalFor(M, levels), c.interval || 1))
      : Math.max(1, c.interval || 1);
    return { ...c, maxPoints: mp, levels, interval, rows: buildScoreRows(mp, levels, interval, c.rows) };
  };
  const distributeTotal = (criteria, total) => {
    const n = criteria.length;
    if (!total || n === 0) return criteria;
    const base = Math.floor(total / n);
    const rem = total - base * n;
    return criteria.map((c, i) => rebuildCriterionForMaxPoints(c, base + (i < rem ? 1 : 0)));
  };
  const addCriterion = (qid) => setQuestions((qs) => qs.map((q) => {
    if (q.id !== qid) return q;
    if (q.criteria.length >= 5) { showToast && showToast('채점 기준은 문항당 최대 5개까지 추가할 수 있습니다.'); return q; }
    const nextCriteria = [...q.criteria, makeCriterion()];
    const total = Number(q.points) || 0;
    return { ...q, criteria: total ? distributeTotal(nextCriteria, total) : nextCriteria };
  }));
  const redistributeTotal = (qid) => setQuestions((qs) => qs.map((q) => {
    if (q.id !== qid) return q;
    const total = Number(q.points) || 0;
    if (!total) { showToast && showToast('먼저 총 배점을 입력해 주세요.'); return q; }
    return { ...q, criteria: distributeTotal(q.criteria, total) };
  }));
  const removeCriterion = (qid, cid) => setQuestions((qs) => qs.map((q) => {
    if (q.id !== qid) return q;
    if (q.criteria.length <= 1) { showToast && showToast('채점 기준은 문항당 최소 1개가 필요합니다.'); return q; }
    return { ...q, criteria: q.criteria.filter((c) => c.id !== cid) };
  }));
  const updateCriterion = (qid, cid, patch) => setQuestions((qs) => qs.map((q) => {
    if (q.id !== qid) return q;
    const nextCriteria = q.criteria.map((c) => {
      if (c.id !== cid) return c;
      const merged = { ...c, ...patch };
      // [v3.73] 단계 수는 [+]/[−] 스텝퍼로만 바뀐다. 배점 입력·수정·삭제는 단계 축소 트리거가 아니다
      if ('maxPoints' in patch || 'levels' in patch || 'interval' in patch) {
        const M = Number(merged.maxPoints) || 0;
        merged.levels = Math.max(2, Number(merged.levels) || 2);
        merged.interval = M >= 2
          ? Math.max(1, Math.min(maxIntervalFor(M, merged.levels), Number(merged.interval) || 1))
          : Math.max(1, Number(merged.interval) || 1);
        merged.rows = buildScoreRows(merged.maxPoints, merged.levels, merged.interval, c.rows);
      }
      return merged;
    });
    // [v2.35] 채점 기준 maxPoints 수정 시 q.points(총 배점)도 합산값으로 자동 갱신
    if ('maxPoints' in patch) {
      const newSum = nextCriteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
      return { ...q, criteria: nextCriteria, points: String(newSum) };
    }
    return { ...q, criteria: nextCriteria };
  }));
  // [v2.35] 총 배점 변경 → 채점 기준 maxPoints 자동 균등 재분배
  const updateQuestionPoints = (qid, raw) => setQuestions((qs) => qs.map((q) => {
    if (q.id !== qid) return q;
    const total = Number(raw) || 0;
    if (total <= 0 || q.criteria.length === 0) return { ...q, points: raw };
    return { ...q, points: raw, criteria: distributeTotal(q.criteria, total) };
  }));
  const changeCriterionLevels = (qid, cid, delta) => {
    const q = questions.find((x) => x.id === qid); const c = q?.criteria.find((x) => x.id === cid);
    if (!c) return;
    const M = Number(c.maxPoints) || 0; const next = c.levels + delta;
    if (next < 2) { showToast && showToast('배점 단계는 최소 2단계입니다.'); return; }
    if (next > clampLevels(M)) { showToast && showToast(`배점 ${M}점에서는 최대 ${clampLevels(M)}단계까지 가능합니다. 배점을 높이면 단계를 늘릴 수 있습니다.`); return; }
    updateCriterion(qid, cid, { levels: next });
  };
  const updateRowDesc = (qid, cid, ri, desc) => setQuestions((qs) => qs.map((q) => q.id !== qid ? q : { ...q, criteria: q.criteria.map((c) => c.id !== cid ? c : { ...c, rows: c.rows.map((r, i) => i === ri ? { ...r, desc } : r) }) }));
  // [v2.35] 점수 행 입력 — 위 단계보다 크거나 아래 단계보다 작은 값 입력 차단 (저장 자체를 막아 「입력 후 경고」 방식 폐기)
  const updateRowScore = (qid, cid, ri, raw) => setQuestions((qs) => qs.map((q) => {
    if (q.id !== qid) return q;
    return { ...q, criteria: q.criteria.map((c) => {
      if (c.id !== cid) return c;
      const M = Number(c.maxPoints) || 0;
      let v = raw;
      if (raw !== '') { let n = Math.round(Number(raw)); if (!Number.isFinite(n)) n = 0; v = Math.max(0, Math.min(M, n)); }
      // [v2.35] 위/아래 행 점수와 비교하여 단조 감소 정책 강제 — 위반 시 입력 차단 + 토스트
      if (v !== '' && v !== null) {
        const prevRaw = ri > 0 ? c.rows[ri - 1].score : null;
        const nextRaw = ri < c.rows.length - 1 ? c.rows[ri + 1].score : null;
        const prev = prevRaw !== null && prevRaw !== '' ? Number(prevRaw) : null;
        const next = nextRaw !== null && nextRaw !== '' ? Number(nextRaw) : null;
        if (prev !== null && Number.isFinite(prev) && v >= prev) {
          showToast && showToast(`위 단계 점수(${prev}점)보다 작아야 합니다.`);
          return c;
        }
        if (next !== null && Number.isFinite(next) && v <= next) {
          showToast && showToast(`아래 단계 점수(${next}점)보다 커야 합니다.`);
          return c;
        }
      }
      return { ...c, rows: c.rows.map((r, i) => i === ri ? { ...r, score: v } : r) };
    }) };
  }));
  const redistribute = (qid, cid) => setQuestions((qs) => qs.map((q) => {
    if (q.id !== qid) return q;
    return { ...q, criteria: q.criteria.map((c) => {
      if (c.id !== cid) return c;
      const interval = defaultInterval(c.maxPoints, c.levels);
      return { ...c, interval, rows: buildScoreRows(c.maxPoints, c.levels, interval, c.rows) };
    }) };
  }));
  // [v2.46] distributeAllByGrade 함수 폐기 — 배점 단계 기능과 역할 중복. ↻ 균등 재분배(redistributeTotal) + ↻ 점수 균등 분배(redistribute)로 충분
  // 자율평가 AI 채점 기준 생성 — 기존 배점·단계 구조 유지, 성취기준 기반 기준명·평가 내용만 채움
  const AI_NAMES = ['내용 이해와 적용', '논리적 구성', '표현의 정확성', '근거의 타당성', '창의적 사고'];
  const AI_QUAL = ['탁월하게', '충실히', '대체로', '부분적으로', '미흡하게'];
  // [중복 제거됨 — 위에 통합 정의 (v2.5 자동 축소 로직 포함)]
  // [v3.46 → v2.34] 과제 단위 성취기준 일괄 적용 — standards 배열도 동기화
  const setStandardForAll = (sid) =>
    setQuestions((qs) => {
      const allSame = qs.every((q) => q.standard === sid);
      const next = allSame ? '' : sid;
      return qs.map((q) => ({ ...q, standard: next, standards: next ? [next] : [] }));
    });
  const aiGenerateCriteria = (qid) => {
    const q0 = questions.find((x) => x.id === qid);
    const std = MOCK_STANDARDS.find((s) => s.id === q0?.standard);
    if (!std) { showToast && showToast('이 문항의 성취기준을 먼저 선택해 주세요. (Step 4)'); return; }
    const area = std.area || '평가 영역';
    const qualityFor = (i, n) => (n <= 1 ? AI_QUAL[0] : AI_QUAL[Math.round((i / (n - 1)) * (AI_QUAL.length - 1))]);
    // [정책] 수동 수정 보존. 빈 칸만 AI가 채움. 재생성은 ✕로 비운 뒤 호출.
    let filled = 0, skipped = 0;
    setQuestions((qs) => qs.map((q) => {
      if (q.id !== qid) return q;
      const criteria = q.criteria.map((c, ci) => {
        const aiName = AI_NAMES[ci % AI_NAMES.length]; const n = c.rows.length;
        const nextName = (c.name && c.name.trim()) ? (skipped++, c.name) : (filled++, aiName);
        const rows = c.rows.map((r, ri) => {
          if (r.desc && r.desc.trim()) { skipped++; return r; }
          filled++;
          return { ...r, desc: `${area} 영역에서 '${nextName || aiName}'을(를) ${qualityFor(ri, n)} 충족함. (성취기준 기준 ${r.score}점 수준)` };
        });
        return { ...c, name: nextName, rows };
      });
      return { ...q, criteria };
    }));
    if (filled === 0) showToast && showToast('빈 칸이 없습니다. ✕ 버튼으로 칸을 비운 뒤 다시 실행하세요.');
    else showToast && showToast(`빈 칸 ${filled}개를 AI가 채웠습니다. 수동 수정한 ${skipped}개 칸은 보존됨. (성취기준 기반 — 검토·수정하세요)`);
  };

  // 스냅 정책 (PRD §3.4) — 그리드 + 인접 영역 모서리 스냅. Shift 키 누르면 임시 비활성
  const [snapEnabled, setSnapEnabled] = useState(true);
  const SNAP_GRID_PCT = 0.01;       // viewBox 폭의 1% 단위 그리드
  const SNAP_THRESHOLD_PCT = 0.015; // viewBox 폭의 1.5% 이내면 스냅
  // 값을 후보 중 가장 가까운 위치로 스냅. threshold 초과 시 원본 반환
  const snapValue = (val, candidates, threshold) => {
    let best = val;
    let bestDist = threshold;
    for (const c of candidates) {
      const d = Math.abs(val - c);
      if (d < bestDist) { bestDist = d; best = c; }
    }
    return best;
  };
  // 그리드 후보 + 다른 영역들의 좌·우 모서리 후보 생성
  const buildSnapCandidates = (axis, excludeId, vb) => {
    const grid = SNAP_GRID_PCT * vb;
    const result = [];
    // 그리드: 0부터 vb까지 grid 간격
    for (let v = 0; v <= vb + 0.001; v += grid) result.push(v);
    // 다른 영역들의 모서리
    for (const a of areas) {
      if (a.id === excludeId) continue;
      if (axis === 'x') { result.push(a.rect.x); result.push(a.rect.x + a.rect.w); }
      else              { result.push(a.rect.y); result.push(a.rect.y + a.rect.h); }
    }
    return result;
  };

  // OCR 자동 감지 (TSK-12 §3.3) — stub. 실제 OCR API 미연동, 데모용 가짜 영역 채움
  const [ocrModal, setOcrModal] = useState(null); // null | { stage: string, progress: number }
  const ocrTimersRef = useRef([]);

  const cancelOcrTimers = () => {
    ocrTimersRef.current.forEach(clearTimeout);
    ocrTimersRef.current = [];
  };

  // 데모 — 페이지 1만 자동 감지 (mock). 페이지 2~ 는 사용자가 직접 그림
  // [v2.79] 다중 페이지 PDF여도 페이지 1만 자동 감지. 이후 페이지는 빈 상태로 진입
  const generateMockDetectedAreas = () => {
    if (!uploadedFile?.pages?.length) return [];
    const firstPage = uploadedFile.pages[0];
    const W = firstPage.width;
    const H = firstPage.height;
    const now = Date.now();
    const passageSample = {
      yRel: 0.02, hRel: 0.08,
      text: '다음 글을 읽고 물음에 답하시오.\n\n글쓴이는 대화에서 상대의 말을 끝까지 듣는 태도가 공동체의 신뢰를 형성한다고 주장한다.',
    };
    const questionSamples = [
      { yRel: 0.13, hRel: 0.20, text: '글쓴이의 주장에 대한 자신의 견해를, 글에 제시된 사례를 1개 이상 인용하여 근거와 함께 서술하시오.' },
      { yRel: 0.38, hRel: 0.22, text: '위 글에서 글쓴이가 제시한 주요 사례를 정리하고, 각 사례가 주장과 어떻게 연결되는지 설명하시오.' },
      { yRel: 0.66, hRel: 0.22, text: '글의 결론과 관련하여, 일상 속에서 실천할 수 있는 방안 한 가지를 제시하고 그 이유를 서술하시오.' },
    ];
    return [
      {
        id: `auto-passage-${now}`,
        type: 'passage', name: '지문', page: 1,
        rect: { x: W * 0.08, y: H * passageSample.yRel, w: W * 0.84, h: H * passageSample.hRel },
        autoDetected: true, ocrText: passageSample.text, customName: false,
      },
      ...questionSamples.map((s, i) => ({
        id: `auto-question-${now}-${i + 1}`,
        type: 'question', name: `문항 ${i + 1}`, page: 1,
        rect: { x: W * 0.08, y: H * s.yRel, w: W * 0.84, h: H * s.hRel },
        autoDetected: true, ocrText: s.text, customName: false,
      })),
    ];
  };

  const runOcrDetection = () => {
    if (!uploadedFile) return;
    const stages = [
      { text: '문제지 레이아웃을 분석하는 중...', progress: 20 },
      { text: '문항 텍스트 블록을 인식하는 중...', progress: 55 },
      { text: '문항 경계를 정리하는 중...',        progress: 88 },
    ];
    setOcrModal({ stage: stages[0].text, progress: 8 });
    cancelOcrTimers();
    stages.forEach((s, i) => {
      const t = setTimeout(() => {
        setOcrModal({ stage: s.text, progress: s.progress });
      }, 500 + i * 600);
    });
    const finishTimer = setTimeout(() => {
      const mock = generateMockDetectedAreas();
      setAreas(sortAndRenumber(mock));
      setOcrModal(null);
      setStep(2);
      setCurrentPage(1); // [v2.73] OCR 직후 항상 1페이지부터 검토
      const pageInfo = totalPages > 1 ? ` (${totalPages}페이지)` : '';
      showToast && showToast(`${mock.length}개 영역을 자동으로 감지했습니다${pageInfo}. 잘못된 영역은 편집할 수 있습니다.`);
    }, 500 + stages.length * 600 + 400);
    ocrTimersRef.current = [...stages.map((_, i) => setTimeout(() => {}, 500 + i * 600)), finishTimer];
  };

  const skipOcrDetection = () => {
    cancelOcrTimers();
    setOcrModal(null);
    setStep(2);
    showToast && showToast('자동 감지를 건너뛰었습니다. 직접 영역을 그려 주세요.');
  };

  // mock 성취기준 (교과·학년 필터 후) — 각 성취기준은 핵심평가영역(area) 1종 + 관련 핵심역량(competencies) 매핑
  // [직접입력 규칙] 성취기준은 핵심평가영역(필수)·핵심역량(선택) 선택에 따라 필터되어 노출된다.
  const MOCK_STANDARDS = [
    { id: 's1', area: '듣기·말하기', competencies: ['의사소통 역량', '공동체·대인관계 역량'], text: '[10국어1-01-01] 대화의 원리를 고려하여 대화하고 자신의 듣기·말하기 과정을 성찰한다.' },
    { id: 's2', area: '읽기', competencies: ['비판적·창의적 사고 역량'], text: '[10국어1-02-01] 글의 주제와 내용을 종합적으로 파악한다.' },
    { id: 's3', area: '읽기', competencies: ['비판적·창의적 사고 역량', '자기 성찰·계발 역량'], text: '[10국어1-02-02] 글에 드러난 관점·표현 방법을 비판적으로 이해한다.' },
    { id: 's4', area: '쓰기', competencies: ['비판적·창의적 사고 역량', '자기 성찰·계발 역량'], text: '[10국어1-03-01] 글의 짜임에 맞게 자신의 생각을 표현한다.' },
    { id: 's5', area: '문법', competencies: ['비판적·창의적 사고 역량'], text: '[10국어1-04-01] 문장 성분을 이해하고 정확하게 표현한다.' },
    { id: 's6', area: '문학', competencies: ['비판적·창의적 사고 역량', '자기 성찰·계발 역량'], text: '[10국어1-05-01] 문학 작품의 내용과 형식을 작품 맥락에서 감상한다.' },
  ];
  const MOCK_COMPETENCIES = ['비판적·창의적 사고 역량', '자기 성찰·계발 역량', '의사소통 역량', '공동체·대인관계 역량'];
  const MOCK_EVAL_AREAS = ['듣기·말하기', '읽기', '쓰기', '문법', '문학'];

  // 평가 단계(등급 체계)별 루브릭 레벨 — DSH-02 등급명·색상과 정합
  const LEVEL_META = {
    '매우 우수': { color: '#10B981', bg: '#D1FAE5', desc: '성취기준을 탁월하게 달성하며, 논리·근거·표현이 모두 빼어나다.' },
    '우수':     { color: '#2A75F3', bg: '#EFF6FF', desc: '성취기준을 충실히 달성하며, 논리적 일관성과 근거가 분명하다.' },
    '보통':     { color: '#94A3B8', bg: '#F1F5F9', desc: '성취기준의 주요 요소를 충족하나, 일부 논리 비약 또는 근거 부족이 관찰된다.' },
    '노력':     { color: '#F59E0B', bg: '#FEF3C7', desc: '성취기준 일부만 충족하며, 핵심 개념의 이해 또는 표현에 어려움이 있다.' },
    '매우 노력': { color: '#EF4444', bg: '#FEE2E2', desc: '문항 요구와 답안 내용이 부합하지 않거나 이해가 매우 미흡하다.' },
  };
  // [v3.53] 4단계 갱신 — 「매우 우수」 복귀, 「매우 노력」 폐기 (GRADE_CUTOFFS와 동기화)
  const RUBRIC_LEVELS = {
    3: ['우수', '보통', '노력'],
    4: ['매우 우수', '우수', '보통', '노력'],
    5: ['매우 우수', '우수', '보통', '노력', '매우 노력'],
  };

  // [v2.7] 문항별 성취기준 후보 — 활성 문항의 evaluationAreas + 과제 단위 competencies 기반
  const filteredStandardsFor = (qEvalAreas) => MOCK_STANDARDS.filter(s => {
    if (!qEvalAreas || qEvalAreas.length === 0) return false;
    if (!qEvalAreas.includes(s.area)) return false;
    if (basicInfo.competencies.length > 0 && !s.competencies.some(c => basicInfo.competencies.includes(c))) return false;
    return true;
  });

  // 파일 업로드 처리 — [v2.73] 이미지/PDF 모두 pages[] 배열로 정규화. PDF는 전체 페이지 렌더
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfLoadProgress, setPdfLoadProgress] = useState(null); // { current, total } | null
  const [currentPage, setCurrentPage] = useState(1);             // 캔버스에 표시 중인 페이지 번호 (1-base)
  // 현재 페이지 데이터 (페이지 전환 시 자동 갱신). uploadedFile 없으면 null
  const currentPageData = uploadedFile?.pages?.[currentPage - 1] || null;
  const totalPages = uploadedFile?.totalPages || (uploadedFile?.pages?.length || 0);
  // 현재 페이지에 속한 영역만 추출 (page 미지정 영역은 1페이지로 간주)
  const currentPageAreas = areas.filter(a => (a.page || 1) === currentPage);

  // [v2.74 → v2.75] 영역 묶기 (group) — 떨어진 영역(다른 페이지·같은 페이지)을 한 문항/한 지문으로 결합
  //   - 묶이지 않은 영역: area.group = null
  //   - 묶음 영역: area.group = { id, partIndex, totalParts } (partIndex/totalParts는 sortAndRenumber가 자동 계산)
  //   - 같은 group.id 영역들은 한 단위 — Step 3 문항 파생도 1 문항으로, 문항 최대 3개 카운트도 묶음 단위
  //   - [v2.75] UX 변경: 캔버스 묶기 모드 폐기 → [합치기] 모달 다중 선택 방식
  //   - [v2.80] UX 변경: 합치기 모달 폐기 → 영역 목록 체크박스 멀티 선택 + 일괄 액션 (삭제/합치기)
  const [linkModalFromAreaId, setLinkModalFromAreaId] = useState(null); // (deprecated v2.80) 모달 호환용 — 더 이상 노출 안 함
  const [linkModalSelectedIds, setLinkModalSelectedIds] = useState(new Set()); // (deprecated v2.80)
  const [checkedAreaIds, setCheckedAreaIds] = useState(new Set()); // [v2.80] 영역 목록 멀티 선택 체크박스
  const [expandedAreaIds, setExpandedAreaIds] = useState(new Set()); // [v2.84] 영역 카드 펼침 (독립 토글, 다른 영역 선택해도 유지)
  const toggleExpanded = (id) => {
    setExpandedAreaIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  // 묶음 단위 list: [{ groupId|null, areas: Area[], firstArea }] — 묶음 ID 없으면 단독 영역
  const computeAreaGroups = (list) => {
    const groups = [];
    const groupMap = new Map(); // groupId -> index in groups
    list.forEach(a => {
      const gid = a.group?.id || null;
      if (gid && groupMap.has(gid)) {
        groups[groupMap.get(gid)].areas.push(a);
      } else if (gid) {
        groupMap.set(gid, groups.length);
        groups.push({ groupId: gid, areas: [a] });
      } else {
        groups.push({ groupId: null, areas: [a] });
      }
    });
    return groups.map(g => ({ ...g, firstArea: g.areas[0] }));
  };
  // 묶음 안의 영역들에서 첫 part(시각·논리 순서 첫 번째) 반환
  const groupFirstPart = (groupId) => {
    if (!groupId) return null;
    const parts = areas.filter(a => a.group?.id === groupId)
      .sort((x, y) => (x.group?.partIndex || 0) - (y.group?.partIndex || 0));
    return parts[0] || null;
  };
  // 같은 group.id의 ocrText를 partIndex 순으로 이어붙임
  const joinedGroupOcrText = (groupId) => {
    if (!groupId) return '';
    const parts = areas.filter(a => a.group?.id === groupId)
      .sort((x, y) => (x.group?.partIndex || 0) - (y.group?.partIndex || 0));
    return parts.map(p => p.ocrText || '').filter(Boolean).join('\n\n[다음 페이지로 이어짐]\n\n');
  };
  // [v2.18 → v2.19] 파일 업로드 진입점 — Step 2 이상으로 진행한 적이 있으면 확인 모달 노출 (TSK-12:파일재업로드확인)
  //   Step 1에만 머문 상태에서 파일만 바꾸는 경우는 경고 없이 즉시 교체 (영역 0 + 다른 입력도 미반영 상태)
  const handleFileUpload = async (file) => {
    if (!file) return;
    const isImage = /^image\//.test(file.type);
    const isPdf = file.type === 'application/pdf';
    if (!isImage && !isPdf) {
      showToast && showToast('PDF 또는 이미지(PNG/JPG)만 업로드 가능합니다.');
      return;
    }
    // Step 2 이상으로 진행 이력 있음 → 확인 모달 노출 후 사용자 [확인] 시 loadFile 진행
    if (hasAdvancedBeyondStep1) {
      setPendingFile(file);
      return;
    }
    await loadFile(file);
  };
  // [v2.20] 파일 제거 진입점 — Step 2+ 진행 이력이 있으면 확인 모달, 아니면 즉시 제거 (TSK-12:파일제거확인)
  const handleRemoveFile = () => {
    if (hasAdvancedBeyondStep1) {
      setPendingRemove(true);
      return;
    }
    performRemoveFile();
  };
  // [v2.20] 실제 파일 제거 로직 — 영역·문항·answerDetails 초기화 + Step 1 복귀 + uploadedFile null
  const performRemoveFile = () => {
    setUploadedFile(null);
    setAreas([]);
    setCurrentPage(1);
    setLinkModalFromAreaId(null);
    setLinkModalSelectedIds(new Set());
    setCheckedAreaIds(new Set());
    setExpandedAreaIds(new Set());
    if (hasAdvancedBeyondStep1) {
      setQuestions([]);
      setAnswerDetails({});
      setStep(1);
      setHasAdvancedBeyondStep1(false);
    }
  };

  // [v2.18 → v2.19] 실제 파일 로드 로직
  //   - 영역 초기화 (필수)
  //   - Step 2+ 진행 이력이 있었으면 문항·성취기준·모범답안·채점 기준도 초기화 (영역과 연동된 데이터)
  //   - 이미지/PDF 변환 후 setUploadedFile
  const loadFile = async (file) => {
    const isImage = /^image\//.test(file.type);
    setAreas([]); // 새 파일 → 영역 초기화
    if (hasAdvancedBeyondStep1) {
      // [v2.19] 다음 단계까지 진행했던 경우 모든 작성 내용 초기화 + Step 1로 복귀
      setQuestions([]);
      setAnswerDetails({});
      setStep(1);
      setHasAdvancedBeyondStep1(false);
    }

    // [v2.73] 이미지/PDF 모두 pages 배열로 정규화 — uploadedFile.pages[i] = { pageNum, dataUrl, width, height }
    setCurrentPage(1);
    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        const img = new Image();
        img.onload = () => {
          setUploadedFile({
            name: file.name, type: file.type, size: file.size,
            totalPages: 1,
            pages: [{
              pageNum: 1,
              dataUrl,
              width: img.naturalWidth,
              height: img.naturalHeight,
            }],
          });
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
      return;
    }

    // PDF: [v2.73] 모든 페이지를 canvas에 순차 렌더링 후 dataUrl로 변환
    try {
      setPdfLoading(true);
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2 }); // 고해상도
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        pages.push({
          pageNum: p,
          dataUrl: canvas.toDataURL('image/png'),
          width: viewport.width,
          height: viewport.height,
        });
        setPdfLoadProgress({ current: p, total: pdf.numPages });
      }
      setUploadedFile({
        name: file.name, type: file.type, size: file.size,
        totalPages: pdf.numPages,
        pages,
      });
    } catch (err) {
      console.error('PDF rendering failed', err);
      showToast && showToast('PDF 로드 실패 — 파일을 확인해 주세요.');
    } finally {
      setPdfLoading(false);
      setPdfLoadProgress(null);
    }
  };

  // 영역 그리기 (SVG 캔버스) — PoC FieldEditor 패턴: getBoundingClientRect 기반 좌표 변환
  // [v2.80] 세로 스크롤 — 페이지마다 SVG ref. drawRefs.current[pageNum] = svgElement
  const drawRefs = useRef({});
  // [v2.81] 캔버스 줌 — Ctrl/⌘ + 마우스 휠로 PDF 페이지 영역만 확대/축소 (25%~400%)
  const [zoom, setZoom] = useState(1);
  const canvasScrollRef = useRef(null);
  const MIN_ZOOM = 0.25, MAX_ZOOM = 4;
  const [drawing, setDrawing] = useState(null); // { startX, startY, currentX, currentY }
  // 인터랙션 — 기존 영역 이동/리사이즈 (PRD §3.4 좌표 수정)
  // { mode: 'move' | 'resize', areaId, handle?: 'nw'|'ne'|'sw'|'se', startX, startY, origRect }
  const [interaction, setInteraction] = useState(null);

  // 실행 취소 히스토리 (Ctrl+Z) — areas 스냅샷 stack, 최대 50개
  const [history, setHistory] = useState([]);
  const MAX_HISTORY = 50;
  const pushHistory = (snapshot) => {
    setHistory((h) => {
      const next = [...h, snapshot];
      return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
    });
  };
  const undo = () => {
    setHistory((h) => {
      if (h.length === 0) {
        showToast && showToast('취소할 작업이 없습니다.');
        return h;
      }
      const prev = h[h.length - 1];
      setAreas(prev);
      return h.slice(0, -1);
    });
  };

  // [v2.85] 슬롯 한도 거부 피드백 — 흔들기(shake)
  //   문항 슬롯이 이미 3개인 상태에서 4번째를 그리거나 복제하려 하면
  //   토스트만으로는 「무엇이 한도에 걸렸는지」가 안 보이므로,
  //   한도를 채운 기존 문항 영역들 + 카운트 배지를 함께 흔들어 원인을 지목한다.
  //   shakeSeq는 연속 시도 시 애니메이션을 재시작시키기 위한 키(동일 대상 재트리거용).
  const [shakeAreaIds, setShakeAreaIds] = useState([]);
  const [shakeSeq, setShakeSeq] = useState(0);
  const shakeTimerRef = useRef(null);
  const SHAKE_MS = 450; // index.css의 tsk12-area-shake duration과 동일해야 함
  const triggerSlotShake = (ids) => {
    if (!ids || ids.length === 0) return;
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    setShakeAreaIds(ids);
    setShakeSeq((n) => n + 1);
    shakeTimerRef.current = setTimeout(() => {
      setShakeAreaIds([]);
      shakeTimerRef.current = null;
    }, SHAKE_MS);
  };
  // 언마운트 시 타이머 정리
  useEffect(() => () => { if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current); }, []);
  // 문항 슬롯 한도 거부 — 토스트 + 기존 문항 영역 전체 흔들기
  const rejectQuestionSlotLimit = (msg) => {
    showToast && showToast(msg);
    triggerSlotShake(areas.filter(a => a.type === 'question').map(a => a.id));
  };

  // 선택 영역 복제 (Ctrl+D) — 약간 오프셋된 위치로 새 영역 생성 + 새 id + 선택 이동
  const duplicateSelected = () => {
    if (!selectedAreaId) {
      showToast && showToast('복제할 영역을 먼저 선택해 주세요.');
      return;
    }
    const src = areas.find(a => a.id === selectedAreaId);
    if (!src) return;
    // [v2.74] 문항 슬롯 최대 3개 — 묶음 단위 카운트 (복제는 새 슬롯이므로 묶음 메타 제거됨)
    if (src.type === 'question') {
      const questionSlots = computeAreaGroups(areas.filter(a => a.type === 'question')).length;
      if (questionSlots >= 3) {
        // [v2.85] 토스트 + 기존 문항 영역 흔들기 (한도에 걸린 대상을 시각적으로 지목)
        rejectQuestionSlotLimit('문항은 최대 3개까지 추가할 수 있습니다. (현재 3개)');
        return;
      }
    }
    // [v2.73] 복제는 원본 영역과 같은 페이지에서 수행 (페이지 간 복제는 불허)
    const srcPage = src.page || 1;
    const srcPageData = uploadedFile?.pages?.[srcPage - 1];
    const vbW = srcPageData?.width || CANVAS_W;
    const vbH = srcPageData?.height || CANVAS_H;
    const offset = vbW * 0.03; // viewBox 폭의 3%
    const w = src.rect.w, h = src.rect.h;
    const samePageAreas = areas.filter(a => (a.page || 1) === srcPage);
    // [겹침 방지] 같은 페이지 안에서만 빈 자리 탐색 (최대 20회)
    let nx = Math.min(vbW - w, src.rect.x + offset);
    let ny = Math.min(vbH - h, src.rect.y + offset);
    let tries = 0;
    while (overlapsOthers({ x: nx, y: ny, w, h }, null, samePageAreas, src.type) && tries < 20) {
      nx = Math.min(vbW - w, nx + offset);
      ny = Math.min(vbH - h, ny + offset);
      tries++;
    }
    if (overlapsOthers({ x: nx, y: ny, w, h }, null, samePageAreas, src.type)) {
      showToast && showToast('복제할 빈 공간이 부족합니다. 영역을 옮긴 뒤 다시 시도해 주세요.');
      return;
    }
    pushHistory(areas);
    const typeMeta = AREA_TYPES.find(t => t.id === src.type);
    const copy = {
      ...src,
      id: `${src.type}-${Date.now()}`,
      // 임시 이름 — sortAndRenumber가 page + y좌표 순으로 재할당
      name: `${typeMeta.label}${src.answerMode === 'choice' && src.choiceLabel ? ` ${src.choiceLabel}` : ''}`,
      page: srcPage,
      rect: { x: nx, y: ny, w, h },
      autoDetected: false,
      customName: false,
      // [v2.74] 복제본은 새 영역 — 묶음 메타 제거
      group: null,
    };
    // [v2.2] 복제 후 자동 채번 (y좌표 순)
    setAreas(sortAndRenumber([...areas, copy]));
    setSelectedAreaId(copy.id);
  };

  // [직접입력 규칙] 핵심평가영역·핵심역량 변경 시, 문항의 성취기준이 더 이상 조건에 맞지 않으면 자동 해제
  useEffect(() => {
    const valid = (sid) => {
      const s = MOCK_STANDARDS.find(x => x.id === sid);
      return !!s && (basicInfo.competencies.length === 0 || s.competencies.some(c => basicInfo.competencies.includes(c)));
    };
    // [v2.7 → v2.34] 핵심역량 변경 시 — invalid한 standards는 자동 해제. standard·standards 동기화
    setQuestions(qs => qs.map(q => {
      const curStandards = q.standards || (q.standard ? [q.standard] : []);
      const validStandards = curStandards.filter(valid);
      if (validStandards.length === curStandards.length) return q;
      return { ...q, standards: validStandards, standard: validStandards[0] || '' };
    }));
  }, [basicInfo.competencies]);

  // 교과 변경 시 — 새 교과 프레임워크에 속하지 않는 기존 선택 chip 자동 해제
  useEffect(() => {
    const allowedComp = new Set(competenciesOf(basicInfo.subject));
    const allowedArea = new Set(evalAreasOf(basicInfo.subject));
    setBasicInfo(p => {
      const nextComp = p.competencies.filter(c => allowedComp.has(c));
      if (nextComp.length === p.competencies.length) return p;
      return { ...p, competencies: nextComp };
    });
    // [v2.7] 모든 문항의 evaluationAreas에서도 정리
    setQuestions(qs => qs.map(q => {
      const nextArea = q.evaluationAreas.filter(a => allowedArea.has(a));
      if (nextArea.length === q.evaluationAreas.length) return q;
      return { ...q, evaluationAreas: nextArea };
    }));
  }, [basicInfo.subject]);

  // [v3.47] 자율평가 selfScale 변경 시 — resultScale(등급 환산 체계)만 동기화. 채점기준 c.levels(점수 행 수)는 채점기준별 자유 유지.
  useEffect(() => {
    if (evalMode !== 'self') return;
    setResultScale(selfScale);
  }, [selfScale, evalMode]);

  // [v2.19] step 변경 추적 — Step 2 이상으로 진입한 적이 있으면 파일 변경 경고 활성화
  useEffect(() => {
    if (step > 1 && !hasAdvancedBeyondStep1) setHasAdvancedBeyondStep1(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // [v3.45] 브라우저 닫기 시 자율평가 합 불일치 → 균등 재분배 후 자동 저장 (sessionStorage)
  useEffect(() => {
    const handler = () => {
      if (evalMode !== 'self') return;
      const hasMismatch = questions.some((q) => {
        const total = Number(q.points) || 0;
        if (!total) return false;
        const sum = q.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
        return sum !== total;
      });
      if (!hasMismatch) return;
      try {
        const redistributed = questions.map((q) => {
          const total = Number(q.points) || 0;
          if (!total) return q;
          const n = q.criteria.length;
          if (!n) return q;
          const base = Math.floor(total / n);
          const rem = total - base * n;
          return { ...q, criteria: q.criteria.map((c, i) => ({ ...c, maxPoints: base + (i < rem ? 1 : 0) })) };
        });
        sessionStorage.setItem(`autoSavedTask_${basicInfo.title || 'untitled'}`,
          JSON.stringify({ title: basicInfo.title, evalMode, questions: redistributed, autoRedistributed: true, timestamp: Date.now() }));
      } catch {}
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [evalMode, questions, basicInfo.title]);

  // 키보드 단축키 (Step 2 전용) — 입력 필드 포커스 시 무시
  //   Ctrl/⌘+Z : 실행 취소
  //   Ctrl/⌘+D : 선택 영역 복제
  //   Delete / Backspace : 선택 영역 삭제
  useEffect(() => {
    if (step !== 2) return;
    const onKey = (e) => {
      const k = (e.key || '').toLowerCase();
      const isCtrl = e.ctrlKey || e.metaKey;
      const tag = document.activeElement?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable;
      if (inField) return;

      if (isCtrl && k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (isCtrl && k === 'd') {
        e.preventDefault(); // 브라우저 기본 동작(즐겨찾기) 차단
        duplicateSelected();
        return;
      }
      if ((k === 'delete' || k === 'backspace') && selectedAreaId) {
        e.preventDefault();
        deleteArea(selectedAreaId);
        return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, selectedAreaId, areas, uploadedFile]);

  // [v2.81] Ctrl/⌘ + 마우스 휠 — 캔버스 영역 확대/축소 (25%~400%). 일반 휠은 세로 스크롤 그대로
  useEffect(() => {
    if (step !== 2) return;
    const el = canvasScrollRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(z => {
        const delta = -e.deltaY * 0.0015; // 휠 위로 → 확대
        return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z + delta));
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [step]);

  // 파일 교체 / Step 1 복귀 시 줌 리셋
  useEffect(() => {
    if (!uploadedFile) setZoom(1);
  }, [uploadedFile]);

  // [영역 겹침 방지] 두 rect가 겹치는지 AABB 검사 — 모서리 맞닿음(eps)은 허용
  const rectsOverlap = (r1, r2) => {
    const eps = 0.5;
    return !(
      r1.x + r1.w <= r2.x + eps ||
      r2.x + r2.w <= r1.x + eps ||
      r1.y + r1.h <= r2.y + eps ||
      r2.y + r2.h <= r1.y + eps
    );
  };
  // [v2.66] 겹침 허용 판정: image 타입은 양방향 겹침 허용
  //   지문·문항 안에 이미지 영역을 두면 해당 좌표만 이미지 crop 추출, 나머지는 OCR 처리
  const overlapAllowedBetween = (typeA, typeB) => (typeA === 'image' || typeB === 'image');
  // rect가 excludeId를 제외한 다른 영역과 하나라도 겹치는지 (areaList는 최신 상태 전달)
  //   currentType 제공 시 image 타입은 겹침 검사 스킵
  const overlapsOthers = (rect, excludeId, areaList, currentType = null) =>
    areaList.some(a => {
      if (a.id === excludeId) return false;
      if (currentType && overlapAllowedBetween(currentType, a.type)) return false;
      return rectsOverlap(rect, a.rect);
    });

  // SVG 표시 크기와 viewBox 비율 보정하여 마우스 좌표를 viewBox 좌표로 변환
  // [v2.80] 세로 스크롤 — 현재 마우스가 진입한 페이지(currentPage)의 SVG ref 사용
  const getSvgXY = (e) => {
    const svg = drawRefs.current[currentPage];
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const vbW = currentPageData?.width || CANVAS_W;
    const vbH = currentPageData?.height || CANVAS_H;
    const scaleX = vbW / rect.width;
    const scaleY = vbH / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    const { x, y } = getSvgXY(e);
    const handle = e.target.dataset?.handle;
    const areaId = e.target.dataset?.areaId;

    // 1) 리사이즈 핸들 클릭 → 리사이즈 시작
    if (handle && areaId) {
      const area = areas.find(a => a.id === areaId);
      if (!area) return;
      pushHistory(areas);
      setSelectedAreaId(areaId);
      setInteraction({ mode: 'resize', areaId, handle, startX: x, startY: y, origRect: { ...area.rect } });
      return;
    }

    // 2) 영역 본체 클릭 → 이동 시작 (+ 선택)
    //    [v2.66] 예외: 현재 활성 타입이 겹침 허용 대상(image)이고, 클릭한 영역과의 조합도 겹침 허용이면
    //    이동이 아니라 새 영역 그리기(drawing)로 전환 → 지문·문항 위에서 바로 이미지 영역을 그릴 수 있음
    if (areaId) {
      const area = areas.find(a => a.id === areaId);
      if (!area) return;
      if (overlapAllowedBetween(activeAreaType, area.type)) {
        // 겹침 허용 상황 → 이 클릭은 「기존 영역을 옮기려는 의도」가 아니라 「그 위에 새 영역을 그리려는 의도」로 해석
        setDrawing({ startX: x, startY: y, currentX: x, currentY: y });
        setSelectedAreaId(null);
        return;
      }
      pushHistory(areas);
      setSelectedAreaId(areaId);
      setInteraction({ mode: 'move', areaId, startX: x, startY: y, origRect: { ...area.rect } });
      return;
    }

    // 3) 빈 영역 → 새 영역 그리기
    setDrawing({ startX: x, startY: y, currentX: x, currentY: y });
    setSelectedAreaId(null);
  };

  const handleMouseMove = (e) => {
    if (!drawing && !interaction) return;
    const { x, y } = getSvgXY(e);

    if (drawing) {
      setDrawing({ ...drawing, currentX: x, currentY: y });
      return;
    }

    if (interaction) {
      const dx = x - interaction.startX;
      const dy = y - interaction.startY;
      // [v2.73] 좌표 한계는 현재 페이지 크기 기준
      const vbW = currentPageData?.width || CANVAS_W;
      const vbH = currentPageData?.height || CANVAS_H;
      const minSize = vbW * 0.005;
      const snapOn = snapEnabled && !e.shiftKey; // Shift 누르면 임시 비활성
      const thX = SNAP_THRESHOLD_PCT * vbW;
      const thY = SNAP_THRESHOLD_PCT * vbW; // 동일 기준으로 viewBox 비례
      const candX = snapOn ? buildSnapCandidates('x', interaction.areaId, vbW) : [];
      const candY = snapOn ? buildSnapCandidates('y', interaction.areaId, vbH) : [];

      setAreas((prev) => prev.map((a) => {
        if (a.id !== interaction.areaId) return a;
        const o = interaction.origRect;
        let nx = o.x, ny = o.y, nw = o.w, nh = o.h;

        if (interaction.mode === 'move') {
          nx = Math.max(0, Math.min(vbW - o.w, o.x + dx));
          ny = Math.max(0, Math.min(vbH - o.h, o.y + dy));
          if (snapOn) {
            // 좌 모서리 스냅과 우 모서리 스냅 중 더 가까운 쪽 선택 (위치만 이동, 크기 보존)
            const leftSnap  = snapValue(nx,         candX, thX);
            const rightSnap = snapValue(nx + nw,    candX, thX) - nw;
            nx = Math.abs(leftSnap - nx) <= Math.abs(rightSnap - nx) ? leftSnap : rightSnap;
            const topSnap    = snapValue(ny,         candY, thY);
            const bottomSnap = snapValue(ny + nh,    candY, thY) - nh;
            ny = Math.abs(topSnap - ny) <= Math.abs(bottomSnap - ny) ? topSnap : bottomSnap;
            nx = Math.max(0, Math.min(vbW - nw, nx));
            ny = Math.max(0, Math.min(vbH - nh, ny));
          }
          // [겹침 방지] 충돌 영역의 경계에 밀착시킴 (근처 스냅으로 붙이기) — 축별 해소
          // [v2.73] 같은 페이지 영역끼리만 검사 (다른 페이지 영역과는 좌표 동일해도 OK)
          // [v2.66] image 타입은 겹침 허용 — 밀착 스냅 스킵 (자유 이동)
          const aPage = a.page || 1;
          const skipOverlap = a.type === 'image';
          const others = skipOverlap ? [] : prev.filter(p => p.id !== a.id && (p.page || 1) === aPage && !overlapAllowedBetween(a.type, p.type));
          // X축: 이동 방향(시작 대비)에 따라 충돌 영역의 반대 면에 붙임
          others.forEach(ot => {
            if (rectsOverlap({ x: nx, y: o.y, w: nw, h: nh }, ot.rect)) {
              if (nx >= o.x) nx = Math.min(nx, ot.rect.x - nw);          // 오른쪽 이동 → 좌측 면에 밀착
              else           nx = Math.max(nx, ot.rect.x + ot.rect.w);   // 왼쪽 이동 → 우측 면에 밀착
            }
          });
          nx = Math.max(0, Math.min(vbW - nw, nx));
          // Y축: 밀착된 nx 기준으로 재검사
          others.forEach(ot => {
            if (rectsOverlap({ x: nx, y: ny, w: nw, h: nh }, ot.rect)) {
              if (ny >= o.y) ny = Math.min(ny, ot.rect.y - nh);          // 아래 이동 → 상단 면에 밀착
              else           ny = Math.max(ny, ot.rect.y + ot.rect.h);   // 위 이동 → 하단 면에 밀착
            }
          });
          ny = Math.max(0, Math.min(vbH - nh, ny));
        } else if (interaction.mode === 'resize') {
          const h = interaction.handle;
          // 핸들이 변경하는 모서리(left/right, top/bottom)에만 스냅 적용
          if (h === 'nw') {
            let lx = Math.min(o.x + o.w - minSize, Math.max(0, o.x + dx));
            let ty = Math.min(o.y + o.h - minSize, Math.max(0, o.y + dy));
            if (snapOn) {
              lx = snapValue(lx, candX, thX);
              ty = snapValue(ty, candY, thY);
            }
            nx = lx; ny = ty;
            nw = o.w - (nx - o.x);
            nh = o.h - (ny - o.y);
          } else if (h === 'ne') {
            let rx = Math.max(o.x + minSize, Math.min(vbW, o.x + o.w + dx));
            let ty = Math.min(o.y + o.h - minSize, Math.max(0, o.y + dy));
            if (snapOn) {
              rx = snapValue(rx, candX, thX);
              ty = snapValue(ty, candY, thY);
            }
            ny = ty;
            nw = rx - o.x;
            nh = o.h - (ny - o.y);
          } else if (h === 'sw') {
            let lx = Math.min(o.x + o.w - minSize, Math.max(0, o.x + dx));
            let by = Math.max(o.y + minSize, Math.min(vbH, o.y + o.h + dy));
            if (snapOn) {
              lx = snapValue(lx, candX, thX);
              by = snapValue(by, candY, thY);
            }
            nx = lx;
            nw = o.w - (nx - o.x);
            nh = by - o.y;
          } else if (h === 'se') {
            let rx = Math.max(o.x + minSize, Math.min(vbW, o.x + o.w + dx));
            let by = Math.max(o.y + minSize, Math.min(vbH, o.y + o.h + dy));
            if (snapOn) {
              rx = snapValue(rx, candX, thX);
              by = snapValue(by, candY, thY);
            }
            nw = rx - o.x;
            nh = by - o.y;
          }
          // 최소 크기 보장
          nw = Math.max(minSize, nw);
          nh = Math.max(minSize, nh);
          // [겹침 방지] 핸들이 움직이는 모서리를 충돌 영역 경계까지만 리사이즈 (겹치는 지점에서 멈춤)
          // [v2.73] 같은 페이지 영역끼리만 검사 (다른 페이지 영역과는 좌표 동일해도 OK)
          // [v2.66] image 타입은 겹침 허용 — 리사이즈 클램프 스킵
          const hdl = interaction.handle;
          const movesRight = hdl === 'ne' || hdl === 'se';
          const movesLeft  = hdl === 'nw' || hdl === 'sw';
          const movesDown  = hdl === 'sw' || hdl === 'se';
          const movesUp    = hdl === 'nw' || hdl === 'ne';
          const aPageR = a.page || 1;
          const skipOverlapR = a.type === 'image';
          if (!skipOverlapR) prev.forEach(ot => {
            if (ot.id === a.id) return;
            if ((ot.page || 1) !== aPageR) return;
            if (overlapAllowedBetween(a.type, ot.type)) return; // image끼리는 겹침 허용
            if (!rectsOverlap({ x: nx, y: ny, w: nw, h: nh }, ot.rect)) return;
            const yOverlap = !(ny + nh <= ot.rect.y || ot.rect.y + ot.rect.h <= ny);
            const xOverlap = !(nx + nw <= ot.rect.x || ot.rect.x + ot.rect.w <= nx);
            if (movesRight && yOverlap && ot.rect.x >= nx) {
              nw = Math.min(nw, ot.rect.x - nx);                 // 우측 면을 충돌 영역 좌측에 클램프
            }
            if (movesLeft && yOverlap && ot.rect.x + ot.rect.w <= nx + nw) {
              const newLeft = Math.max(nx, ot.rect.x + ot.rect.w);
              nw = (nx + nw) - newLeft; nx = newLeft;             // 좌측 면을 충돌 영역 우측에 클램프
            }
            if (movesDown && xOverlap && ot.rect.y >= ny) {
              nh = Math.min(nh, ot.rect.y - ny);                 // 하단 면을 충돌 영역 상단에 클램프
            }
            if (movesUp && xOverlap && ot.rect.y + ot.rect.h <= ny + nh) {
              const newTop = Math.max(ny, ot.rect.y + ot.rect.h);
              nh = (ny + nh) - newTop; ny = newTop;              // 상단 면을 충돌 영역 하단에 클램프
            }
          });
          nw = Math.max(minSize, nw);
          nh = Math.max(minSize, nh);
        }
        return { ...a, rect: { x: nx, y: ny, w: nw, h: nh }, autoDetected: false };
      }));
    }
  };

  const handleMouseUp = () => {
    if (interaction) {
      setInteraction(null);
      return;
    }
    if (!drawing) return;
    const x = Math.min(drawing.startX, drawing.currentX);
    const y = Math.min(drawing.startY, drawing.currentY);
    const w = Math.abs(drawing.currentX - drawing.startX);
    const h = Math.abs(drawing.currentY - drawing.startY);
    // 너무 작은 사각형 (실수 클릭 등) 무시 — viewBox 좌표 기준이라 임계값을 viewBox 비례로
    // [v2.73] viewBox는 현재 페이지 기준
    const vbW = currentPageData?.width || CANVAS_W;
    const minSize = vbW * 0.01; // viewBox의 1% 미만은 무시
    if (w > minSize && h > minSize) {
      // [v2.74] 문항 슬롯 최대 3개 — 묶음 단위 카운트 (같은 group.id는 1 슬롯)
      const questionSlots = computeAreaGroups(areas.filter(a => a.type === 'question')).length;
      if (activeAreaType === 'question' && questionSlots >= 3) {
        // [v2.85] 토스트 + 기존 문항 영역 흔들기 (한도에 걸린 대상을 시각적으로 지목)
        rejectQuestionSlotLimit('문항은 최대 3개까지 추가할 수 있습니다. (현재 3개, 묶음은 1개로 카운트)');
        setDrawing(null);
        return;
      }
      // [겹침 방지] 현재 페이지 내 다른 영역과 겹치면 생성 취소 (다른 페이지 영역과는 좌표 동일해도 OK)
      //   [v2.66] image 타입은 지문·문항·다른 이미지와 겹침 허용 (양방향)
      if (overlapsOthers({ x, y, w, h }, null, currentPageAreas, activeAreaType)) {
        showToast && showToast('다른 영역과 겹쳐 영역을 만들 수 없습니다. 겹치지 않는 위치에 그려 주세요.');
        setDrawing(null);
        return;
      }
      pushHistory(areas);
      const typeMeta = AREA_TYPES.find(t => t.id === activeAreaType);
      const newArea = {
        id: `${activeAreaType}-${Date.now()}`,
        type: activeAreaType,
        // 임시 이름 — 곧바로 sortAndRenumber가 y좌표 순으로 재할당
        name: `${typeMeta.label}`,
        // [v2.73] 새 영역은 현재 페이지에 속함. 페이지 간 이동은 불허
        page: currentPage,
        rect: { x, y, w, h },
        customName: false,
      };
      // [v2.2] 새 영역 추가 후 자동 채번 (page + y좌표 순)
      setAreas(sortAndRenumber([...areas, newArea]));
      setSelectedAreaId(newArea.id);
    }
    setDrawing(null);
  };

  // [v2.2] 영역 자동 채번 — 같은 타입 영역을 y좌표(위→아래) 순으로 정렬하여 「{타입라벨} N」 번호 재할당.
  // 사용자가 이름을 직접 변경한 영역(customName: true)은 보존하되 번호 슬롯은 차지함.
  const sortAndRenumber = (list) => {
    // [v2.73] page 우선, 그 다음 y, 그 다음 x (다중 페이지 통합 연번 유지)
    const sorted = [...list].sort((a, b) => {
      const pa = a.page || 1, pb = b.page || 1;
      if (pa !== pb) return pa - pb;
      if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
      return a.rect.x - b.rect.x;
    });
    // [v2.74] 묶음 단위 채번 + partIndex/totalParts 자동 갱신
    //   - 같은 group.id 영역들은 1 슬롯만 차지 (한 문항/지문)
    //   - 묶음 안 영역들의 이름은 동일 (예: 둘 다 '문항 2')
    //   - 묶음 안 영역들의 group.partIndex/totalParts는 sorted 순서 기준 자동 부여
    const groupNumberMap = new Map();   // type+groupId → 부여된 번호
    const groupPartIndex = new Map();   // groupId → 다음 part 번호
    const groupTotalParts = new Map();  // groupId → totalParts
    sorted.forEach(a => {
      if (a.group?.id) {
        groupTotalParts.set(a.group.id, (groupTotalParts.get(a.group.id) || 0) + 1);
      }
    });
    return sorted.map((a) => {
      const typeMeta = AREA_TYPES.find(t => t.id === a.type);
      const gid = a.group?.id || null;
      // partIndex 자동 부여 (page → y 순)
      let nextGroup = a.group;
      if (gid) {
        const nextPart = (groupPartIndex.get(gid) || 0) + 1;
        groupPartIndex.set(gid, nextPart);
        nextGroup = { id: gid, partIndex: nextPart, totalParts: groupTotalParts.get(gid) };
      }
      if (a.customName) return { ...a, group: nextGroup };
      // 묶음 단위 번호 부여
      let myNumber;
      if (gid) {
        const key = `${a.type}::${gid}`;
        if (groupNumberMap.has(key)) {
          myNumber = groupNumberMap.get(key);
        } else {
          // 같은 type에서 이미 부여된 번호의 최댓값 + 1
          const usedNumbers = [...groupNumberMap.entries()]
            .filter(([k]) => k.startsWith(`${a.type}::`))
            .map(([, v]) => v);
          const ungroupedCount = sorted.filter(x => x.type === a.type && !x.group?.id)
            .findIndex(x => false); // placeholder
          // 단독 영역까지 합한 슬롯 인덱스 — 정렬 순서 기준으로 슬롯 추출
          const slotIndex = countSlotIndex(sorted, a);
          myNumber = slotIndex;
          groupNumberMap.set(key, myNumber);
        }
      } else {
        myNumber = countSlotIndex(sorted, a);
      }
      return { ...a, group: nextGroup, name: `${typeMeta.label} ${myNumber}` };
    });
  };

  // [v2.75] 묶기 — 시작 영역 + N개 대상 영역을 한 묶음으로 결합 (같은 type만 허용)
  const linkAreasMulti = (fromId, toIds) => {
    const from = areas.find(a => a.id === fromId);
    if (!from || !toIds?.length) return;
    const validTos = toIds
      .filter(id => id !== fromId)
      .map(id => areas.find(a => a.id === id))
      .filter(a => a && a.type === from.type);
    if (validTos.length === 0) {
      showToast && showToast('같은 타입의 영역을 1개 이상 선택해 주세요.');
      return;
    }
    // 이미 묶여있는 영역들의 group.id를 모두 모아서 from.group.id (또는 새 id)로 병합
    let newGroupId = from.group?.id || `grp-${Date.now()}`;
    const oldGroupIds = new Set();
    [from, ...validTos].forEach(a => { if (a.group?.id) oldGroupIds.add(a.group.id); });
    // 같은 묶음 안의 모든 기존 part까지 멤버에 포함
    const memberIds = new Set([fromId, ...validTos.map(a => a.id)]);
    areas.forEach(a => { if (oldGroupIds.has(a.group?.id)) memberIds.add(a.id); });

    pushHistory(areas);
    const updated = areas.map(a =>
      memberIds.has(a.id)
        ? { ...a, group: { id: newGroupId, partIndex: 0, totalParts: 0 }, customName: false }
        : a
    );
    setAreas(sortAndRenumber(updated));
    const typeMeta = AREA_TYPES.find(t => t.id === from.type);
    showToast && showToast(`${memberIds.size}개 ${typeMeta.label} 영역을 한 묶음으로 결합했습니다.`);
  };

  // [v2.75] 영역 카드 렌더 헬퍼 — 단독 영역 및 묶음 part 모두 동일 컴포넌트로 렌더
  // isInGroup=true면 묶음 박스 안에 있는 part (왼쪽 들여쓰기 + 묶음 색 좌측 띠)
  const AreaCardRenderer = ({ area: a, t, isInGroup }) => {
    const isSelected = selectedAreaId === a.id;
    const isChecked = checkedAreaIds.has(a.id);
    const isExpanded = expandedAreaIds.has(a.id); // [v2.84] 펼침은 독립 토글
    return (
      <div
        key={a.id}
        style={{
          padding: '8px 10px', borderRadius: '8px',
          border: '1px solid',
          borderColor: isChecked ? t.stroke : (isSelected ? t.stroke : '#E2E8F0'),
          background: isChecked ? `${t.stroke}10` : (isSelected ? t.fill : 'white'),
          cursor: 'pointer',
          borderLeft: isInGroup ? `4px solid ${t.stroke}` : `1px solid ${isChecked || isSelected ? t.stroke : '#E2E8F0'}`,
        }}
        onClick={() => {
          const areaPage = a.page || 1;
          if (areaPage !== currentPage) setCurrentPage(areaPage);
          // [v2.80] 세로 스크롤 — 해당 페이지로 자동 스크롤
          const target = document.getElementById(`tsk12-page-${areaPage}`);
          if (target && typeof target.scrollIntoView === 'function') {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          // [v2.84] selectedAreaId는 단일 선택 (캔버스 핸들 표시용) — 클릭한 영역으로 변경
          //         펼침(expanded)은 독립 토글 — 같은 영역 재클릭 시만 닫힘. 다른 영역 선택해도 이전 펼침 유지
          setSelectedAreaId(a.id);
          toggleExpanded(a.id);
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* [v2.80] 체크박스 — 멀티 선택 일괄 액션용 */}
          <input
            type="checkbox"
            checked={isChecked}
            onChange={(e) => { e.stopPropagation(); toggleAreaChecked(a.id); }}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 16, height: 16, accentColor: t.stroke, cursor: 'pointer', flexShrink: 0 }}
          />
          <span>{t.icon}</span>
          {editingAreaNameId === a.id ? (
            <input
              autoFocus
              value={editingAreaNameValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setEditingAreaNameValue(e.target.value)}
              onBlur={commitEditAreaName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitEditAreaName(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelEditAreaName(); }
              }}
              style={{ flex: 1, fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1E293B', padding: '3px 6px', border: '1px solid #2A75F3', borderRadius: 4, outline: 'none' }}
            />
          ) : (
            <span style={{ flex: 1, fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1E293B', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {a.name}
              {totalPages > 1 && (
                <span title={`${a.page || 1}페이지에 위치`} style={{
                  fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#0369A1',
                  background: '#E0F2FE', border: '1px solid #BAE6FD',
                  padding: '1px 6px', borderRadius: '999px',
                }}>p{a.page || 1}</span>
              )}
              {/* [v2.78] 영역 목록 카드의 묶음 배지(🔗 N/M) 제거 — 묶음 외곽 박스·좌측 색 띠로 이미 시각 식별 가능 */}
              {a.autoDetected && <span title="자동 감지된 영역" style={{ fontSize: 'var(--neo-font-size-xs)', color: '#1D4ED8' }}>🤖</span>}
              {a.customName && <span title="이름 수정된 영역" style={{ fontSize: 'var(--neo-font-size-xs)', color: '#7C3AED' }}>✏️</span>}
              {/* [v2.66] 지문·문항 내부에 포함된 이미지 영역 카운트 — OCR 파이프라인에서 인라인 이미지로 추출 */}
              {(a.type === 'passage' || a.type === 'question') && (() => {
                const inlineCnt = areas.filter(x => {
                  if (x.type !== 'image') return false;
                  if ((x.page || 1) !== (a.page || 1)) return false;
                  // x.rect의 중심점이 a.rect 안에 있는지 검사 (완전 포함이 아니라 대체로 포함 판정)
                  const cx = x.rect.x + x.rect.w / 2;
                  const cy = x.rect.y + x.rect.h / 2;
                  return cx >= a.rect.x && cx <= a.rect.x + a.rect.w && cy >= a.rect.y && cy <= a.rect.y + a.rect.h;
                }).length;
                if (inlineCnt === 0) return null;
                return (
                  <span title={`이 영역 내부에 이미지 영역 ${inlineCnt}개가 포함되어 있습니다. OCR 처리 시 해당 좌표는 이미지로 추출되고 나머지는 텍스트 인식됩니다.`}
                    style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#B45309', background: '#FEF3C7', border: '1px solid #FDE68A', padding: '1px 6px', borderRadius: 999 }}>
                    🟨 인라인 이미지 {inlineCnt}
                  </span>
                );
              })()}
            </span>
          )}
          {editingAreaNameId !== a.id && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); moveArea(a.id, -1); }}
                title="위로 이동 (같은 타입 영역과 위치 교환)"
                style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid #CBD5E1', background: 'white', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', color: '#475569', fontWeight: 800, lineHeight: 1 }}
              >▲</button>
              <button
                onClick={(e) => { e.stopPropagation(); moveArea(a.id, +1); }}
                title="아래로 이동 (같은 타입 영역과 위치 교환)"
                style={{ padding: '2px 6px', borderRadius: '4px', border: '1px solid #CBD5E1', background: 'white', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', color: '#475569', fontWeight: 800, lineHeight: 1 }}
              >▼</button>
              <button
                onClick={(e) => { e.stopPropagation(); startEditAreaName(a); }}
                title="이름 변경"
                style={{ padding: '2px 7px', borderRadius: '4px', border: '1px solid #CBD5E1', background: 'white', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', color: '#475569', fontWeight: 700 }}
              >✏️</button>
              {/* [v2.82] 개별 part 분리 버튼 폐기 — 묶음 박스 헤더 [🔗✕ 묶음 해제]로 통일 */}
              <button
                onClick={(e) => { e.stopPropagation(); deleteArea(a.id); }}
                title="삭제"
                style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid #FECACA', background: 'white', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', color: '#DC2626', fontWeight: 700 }}
              >🗑️</button>
            </>
          )}
        </div>
        {isExpanded && (
          <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #CBD5E1' }}>
            <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', fontWeight: 700, marginBottom: '4px' }}>타입 변경</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {AREA_TYPES.map(tp => {
                const isCurrent = a.type === tp.id;
                return (
                  <button
                    key={tp.id}
                    onClick={(e) => { e.stopPropagation(); changeAreaType(a.id, tp.id); }}
                    disabled={isCurrent}
                    style={{
                      padding: '4px 8px', borderRadius: '12px',
                      border: '1px solid', borderColor: isCurrent ? tp.color : '#E2E8F0',
                      background: isCurrent ? tp.color : 'white',
                      color: isCurrent ? 'white' : tp.color,
                      fontSize: 'var(--neo-font-size-xs)', fontWeight: 800,
                      cursor: isCurrent ? 'default' : 'pointer',
                    }}
                  >
                    {tp.icon} {tp.label}{isCurrent ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // [v2.80] 영역 목록 체크박스 토글 + 일괄 액션
  const toggleAreaChecked = (areaId) => {
    setCheckedAreaIds(prev => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
  };
  const clearAllChecked = () => setCheckedAreaIds(new Set());
  // 일괄 삭제
  const bulkDeleteChecked = () => {
    if (checkedAreaIds.size === 0) return;
    if (!window.confirm(`선택한 ${checkedAreaIds.size}개 영역을 삭제하시겠습니까?`)) return;
    pushHistory(areas);
    let updated = areas.filter(a => !checkedAreaIds.has(a.id));
    // 묶음 part가 1개만 남으면 자동 해제
    const affectedGroups = new Set();
    areas.forEach(a => { if (checkedAreaIds.has(a.id) && a.group?.id) affectedGroups.add(a.group.id); });
    affectedGroups.forEach(gid => {
      const remaining = updated.filter(a => a.group?.id === gid);
      if (remaining.length === 1) {
        updated = updated.map(a => a.id === remaining[0].id ? { ...a, group: null, customName: false } : a);
      }
    });
    setAreas(sortAndRenumber(updated));
    clearAllChecked();
    setSelectedAreaId(null);
  };
  // 일괄 합치기 — 체크된 2개 이상 영역 결합 (같은 type만 허용)
  const bulkLinkChecked = () => {
    if (checkedAreaIds.size < 2) return;
    const ids = Array.from(checkedAreaIds);
    const target = areas.find(a => a.id === ids[0]);
    if (!target) return;
    // 타입 검증
    const allSameType = ids.every(id => areas.find(a => a.id === id)?.type === target.type);
    if (!allSameType) {
      showToast && showToast('같은 타입의 영역끼리만 합칠 수 있습니다. (지문은 지문끼리, 문항은 문항끼리)');
      return;
    }
    linkAreasMulti(ids[0], ids.slice(1));
    clearAllChecked();
  };
  // 체크된 영역들의 type 동일성 — 합치기 활성/비활성 판단용
  const checkedAreasSameType = (() => {
    if (checkedAreaIds.size < 2) return true; // 1개 이하는 합치기 무관
    const firstType = areas.find(a => checkedAreaIds.has(a.id))?.type;
    return Array.from(checkedAreaIds).every(id => areas.find(a => a.id === id)?.type === firstType);
  })();

  // [v2.75] 묶기 모달 열기 / 닫기 (deprecated v2.80 — 영역 카드 [🔗] 버튼 제거됨)
  const openLinkModal = (areaId) => {
    setLinkModalFromAreaId(areaId);
    setLinkModalSelectedIds(new Set());
  };
  const closeLinkModal = () => {
    setLinkModalFromAreaId(null);
    setLinkModalSelectedIds(new Set());
  };
  const toggleLinkModalSelection = (areaId) => {
    setLinkModalSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
  };
  const confirmLinkModal = () => {
    if (!linkModalFromAreaId || linkModalSelectedIds.size === 0) return;
    linkAreasMulti(linkModalFromAreaId, Array.from(linkModalSelectedIds));
    closeLinkModal();
  };

  // [v2.74] 묶음 해제 — 영역 1개를 묶음에서 분리. 남은 묶음 영역이 1개면 그것도 자동 해제
  const unlinkArea = (areaId) => {
    const target = areas.find(a => a.id === areaId);
    if (!target?.group?.id) return;
    const gid = target.group.id;
    pushHistory(areas);
    const remaining = areas.filter(a => a.group?.id === gid && a.id !== areaId);
    const updated = areas.map(a => {
      if (a.id === areaId) return { ...a, group: null, customName: false };
      // 묶음 part가 1개만 남으면 그 part도 자동 해제 (묶음의 의미 없음)
      if (remaining.length === 1 && a.id === remaining[0].id) {
        return { ...a, group: null, customName: false };
      }
      return a;
    });
    setAreas(sortAndRenumber(updated));
    showToast && showToast('묶음에서 영역을 분리했습니다.');
  };

  // [v2.74] 같은 type 안에서 묶음 1개 = 슬롯 1개. 영역 a의 슬롯 번호 (1-base)
  const countSlotIndex = (sorted, a) => {
    let slot = 0;
    const seenGroups = new Set();
    for (const x of sorted) {
      if (x.type !== a.type) continue;
      const xgid = x.group?.id || null;
      if (xgid) {
        if (!seenGroups.has(xgid)) {
          seenGroups.add(xgid);
          slot++;
        }
      } else {
        slot++;
      }
      if (x.id === a.id) return slot;
    }
    return slot;
  };

  const deleteArea = (id) => {
    pushHistory(areas);
    const target = areas.find(a => a.id === id);
    let filtered = areas.filter(a => a.id !== id);
    // [v2.74] 묶음 part 삭제 후 같은 묶음에 1개만 남으면 그 part도 자동 해제 (묶음의 의미 없음)
    if (target?.group?.id) {
      const remaining = filtered.filter(a => a.group?.id === target.group.id);
      if (remaining.length === 1) {
        filtered = filtered.map(a =>
          a.id === remaining[0].id ? { ...a, group: null, customName: false } : a
        );
      }
    }
    // [v2.2] 삭제 후 같은 타입 영역의 번호를 위→아래 순으로 자동 재정렬 (예: 문항 1·2·3 중 2 삭제 → 1·2로 정렬)
    setAreas(sortAndRenumber(filtered));
    if (selectedAreaId === id) setSelectedAreaId(null);
  };

  // [v2.9] 사이드바 [↑] [↓] — 같은 타입 영역끼리 캔버스 y좌표 swap → sortAndRenumber로 번호 자동 재할당
  //   - dir: -1(위) / +1(아래)
  //   - 같은 타입 안에서 인접한 영역과 y좌표 교환 (위 끝/아래 끝이면 무동작)
  //   - customName 영역도 위치 swap 가능. 채번은 customName 보존 정책 그대로
  const moveArea = (id, dir) => {
    const target = areas.find(a => a.id === id);
    if (!target) return;
    // 같은 타입을 y좌표 순으로 정렬한 배열에서 인접 영역 찾기
    const sameType = areas.filter(a => a.type === target.type).sort((a, b) => {
      if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
      return a.rect.x - b.rect.x;
    });
    const idx = sameType.findIndex(a => a.id === id);
    const neighborIdx = idx + dir;
    if (neighborIdx < 0 || neighborIdx >= sameType.length) {
      showToast && showToast(dir < 0 ? '이미 맨 위의 영역입니다.' : '이미 맨 아래의 영역입니다.');
      return;
    }
    const neighbor = sameType[neighborIdx];
    pushHistory(areas);
    // 두 영역의 rect.y를 교환 (x, w, h는 그대로). 시각적으로 위치 swap
    const newAreas = areas.map(a => {
      if (a.id === target.id) return { ...a, rect: { ...a.rect, y: neighbor.rect.y } };
      if (a.id === neighbor.id) return { ...a, rect: { ...a.rect, y: target.rect.y } };
      return a;
    });
    setAreas(sortAndRenumber(newAreas));
  };

  // [v2.2] 영역 이름 인라인 편집 — 변경 시 customName: true + autoDetected: false (사용자 확정)
  const startEditAreaName = (a) => {
    setEditingAreaNameId(a.id);
    setEditingAreaNameValue(a.name);
  };
  const commitEditAreaName = () => {
    const id = editingAreaNameId;
    const next = editingAreaNameValue.trim();
    setEditingAreaNameId(null);
    setEditingAreaNameValue('');
    if (!id) return;
    if (!next) { showToast && showToast('영역 이름은 빈 값으로 둘 수 없습니다.'); return; }
    pushHistory(areas);
    setAreas(areas.map(a => a.id === id ? { ...a, name: next, customName: true, autoDetected: false } : a));
  };
  const cancelEditAreaName = () => {
    setEditingAreaNameId(null);
    setEditingAreaNameValue('');
  };

  // 영역 타입 변경 — 선택된 새 타입으로 즉시 변경 + 이름도 새 타입 기준으로 자동 갱신
  // 자동 감지 영역을 사용자가 편집하면 autoDetected: false 전환 (PRD §3.4)
  const changeAreaType = (id, newType) => {
    pushHistory(areas);
    const target = areas.find(a => a.id === id);
    let updated = areas.map(a => {
      if (a.id !== id) return a;
      if (a.type === newType) return a; // 동일 타입 클릭은 무시
      // [v2.2] 타입 변경 시 customName 해제 — 새 타입 라벨에 맞춰 채번
      // [v2.74] 타입 변경 시 묶음에서 자동 분리 (다른 타입과는 묶일 수 없음)
      return { ...a, type: newType, customName: false, autoDetected: false, group: null };
    });
    // [v2.74] 변경 후 같은 묶음에 1개만 남으면 그 part도 자동 해제
    if (target?.group?.id && target.type !== newType) {
      const remaining = updated.filter(a => a.group?.id === target.group.id);
      if (remaining.length === 1) {
        updated = updated.map(a =>
          a.id === remaining[0].id ? { ...a, group: null, customName: false } : a
        );
      }
    }
    setAreas(sortAndRenumber(updated));
  };

  // Step 진행 가능 여부
  const canNext = () => {
    if (step === 1) {
      // Step 1 통합: 과제명 + 파일 업로드
      return !!uploadedFile && !!basicInfo.title.trim();
    }
    if (step === 2) {
      // [v2.77] 묶음 단위 슬롯 카운트로 검증
      //   - 문항: 1개 이상, 3개 이하 (묶음 1개 = 1 슬롯)
      //   - 지문: 0개 또는 1개 (있다면 정확히 1개. 2개 이상이면 합치기 필요)
      const qSlots = computeAreaGroups(areas.filter(a => a.type === 'question')).length;
      const pSlots = computeAreaGroups(areas.filter(a => a.type === 'passage')).length;
      return qSlots >= 1 && qSlots <= 3 && pSlots <= 1;
    }
    if (step === 3) {
      // 문항 입력: 모든 문항의 내용 입력 필수 (모범답안은 Step 4에서)
      return questions.length > 0 && questions.every(q => q.content.trim());
    }
    if (step === 4) {
      // [v2.7] 각 문항이 자체 evaluationAreas ≥ 1 + standard 매핑 + 모범답안(상·중·하)
      return questions.length > 0 && questions.every(q =>
        q.evaluationAreas.length > 0 &&
        !!q.standard && isModelAnswerFilled(q));
    }
    if (step === 5) {
      if (questions.length === 0) return false;
      if (evalMode === 'auto') return questions.every(q => Number(q.points) > 0);
      // 자율평가: 채점기준 valid + 총 배점 입력 시 합 일치 필수
      return questions.every(q => {
        const ok = q.criteria.every(c => Number(c.maxPoints) > 0 && c.name.trim() && c.rows.every(r => r.score !== '') && rowsDescending(c.rows));
        if (!ok) return false;
        const total = Number(q.points) || 0;
        if (total > 0) {
          const sum = q.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
          if (sum !== total) return false;
        }
        return true;
      });
    }
    return false; // step 6 — 마지막, 저장 버튼으로 처리
  };

  // 파일 업로드 + 과제명만 있으면 저장 가능
  const canSave = !!(uploadedFile && basicInfo.title.trim());
  // 자율평가 — 채점기준 합 ≠ 총 배점 문항 list
  const getMismatchQuestions = () => {
    if (evalMode !== 'self') return [];
    return questions.map((q, idx) => {
      const total = Number(q.points) || 0;
      if (!total) return null;
      const sum = q.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
      if (sum === total) return null;
      return { idx: idx + 1, qid: q.id, total, sum, diff: sum - total };
    }).filter(Boolean);
  };
  const [saveMismatchModal, setSaveMismatchModal] = useState(null);
  const performSave = () => {
    // [v3.46] 영속화 — 부모에게 task 객체 전달 (BASE_TASKS 호환 + source 메타 포함)
    if (onAdd) {
      const task = buildFileUploadTask({
        basicInfo, uploadedFile, areas, answerDetails, questions,
        evalMode, autoScale, rubricOverrides, groupList, isShared,
      });
      onAdd(task);
    }
    showToast && showToast(`과제 「${basicInfo.title || '제목 없음'}」가 등록되었습니다.`);
    onBack && onBack();
  };
  const handleSave = () => {
    if (!canSave) { showToast && showToast('파일 업로드와 과제명을 입력해야 저장할 수 있습니다.'); return; }
    const mismatches = getMismatchQuestions();
    if (mismatches.length > 0) { setSaveMismatchModal({ items: mismatches }); return; }
    performSave();
  };
  const redistributeAllAndSave = () => {
    setQuestions((qs) => qs.map((q) => {
      const total = Number(q.points) || 0;
      if (!total) return q;
      return { ...q, criteria: distributeTotal(q.criteria, total) };
    }));
    setSaveMismatchModal(null);
    setTimeout(performSave, 0);
  };
  const handleExitNoSave = () => { if (window.confirm('저장하지 않고 나가시겠습니까? 작성 중인 내용은 사라집니다.')) onBack && onBack(); };
  const handleDelete = () => { if (window.confirm('이 과제를 삭제하시겠습니까? 되돌릴 수 없습니다.')) { showToast && showToast('과제를 삭제했습니다.'); onBack && onBack(); } };
  const handleToggleShare = () => { setIsShared((s) => { const next = !s; showToast && showToast(next ? '과제를 공유했습니다.' : '과제 공유를 취소했습니다.'); return next; }); };

  // 헤더 더보기 메뉴 (공유 / 과제파일관리 / 삭제)
  const [moreOpen, setMoreOpen] = useState(false);
  const [isShared, setIsShared] = useState(false);
  // [v2.11] 응시 설정 — 복사·붙여넣기 차단 (학생 응시 화면 정책, TaskRegistration 직접입력1과 동일)
  const [blockCopyPaste, setBlockCopyPaste] = useState(false);
  // [v2.15] AI 개선 모달 — 문항 내용 다듬기 (TSK-13과 동일 패턴)
  const [aiImprove, setAiImprove] = useState(null); // { qid, original, improved }
  // [v2.16] 자율평가 평가내용의 수식 입력 모달 (TSK-13 v2.15와 동일 패턴)
  const [formulaModal, setFormulaModal] = useState(null);
  // [v2.18] 파일 교체 확인 모달 — Step 2+ 진행 이력이 있는 상태에서 새 파일 업로드 시 확인 (TSK-12:파일재업로드확인)
  const [pendingFile, setPendingFile] = useState(null);
  // [v2.19] Step 2 이상으로 한 번이라도 진행한 적이 있는가 (파일 변경 경고 트리거)
  const [hasAdvancedBeyondStep1, setHasAdvancedBeyondStep1] = useState(false);
  // [v2.20] 파일 제거 확인 모달 — Step 2+ 진행 이력이 있는 상태에서 파일 제거 시 확인 (TSK-12:파일제거확인)
  const [pendingRemove, setPendingRemove] = useState(false);
  // AI 개선 stub — 공백 정규화 + 종결부호 보정 (실제 LLM 미연동)
  const improveQuestionText = (t) => {
    let s = (t || '').replace(/\s+/g, ' ').trim();
    if (!s) return s;
    if (!/[.?!」』)]$/.test(s)) s += '.';
    return s;
  };
  const openAiImprove = (qid) => {
    const q = questions.find((x) => x.id === qid);
    if (!q || !q.content.trim()) { showToast && showToast('AI 개선을 위해 문항 내용을 먼저 입력해 주세요.'); return; }
    setAiImprove({ qid, original: q.content, improved: improveQuestionText(q.content) });
  };
  const applyAiImprove = () => {
    if (!aiImprove) return;
    updateQuestion(aiImprove.qid, { content: aiImprove.improved });
    setAiImprove(null);
    showToast && showToast('AI 개선 내용을 적용했습니다.');
  };
  const importInputRef = useRef(null);
  const handleExport = () => {
    const data = { basicInfo, areas, answerDetails, questions, evalMode, autoScale, selfScale, resultScale, rubricOverrides, groupList };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${(basicInfo.title || 'task').replace(/[\\/:*?"<>|]/g, '_')}.json`; a.click();
    URL.revokeObjectURL(url);
    setMoreOpen(false);
    showToast && showToast('과제를 내보냈습니다.');
  };
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.basicInfo) setBasicInfo((p) => ({ ...p, ...data.basicInfo }));
        if (Array.isArray(data.areas)) setAreas(data.areas);
        if (data.answerDetails) setAnswerDetails(data.answerDetails);
        if (Array.isArray(data.questions)) setQuestions(data.questions);
        if (data.evalMode) setEvalMode(data.evalMode);
        if (data.autoScale) setAutoScale(data.autoScale);
        if (data.resultScale) setResultScale(data.resultScale);
        if (data.selfScale) setSelfScale(data.selfScale);
        if (data.rubricOverrides) setRubricOverrides(data.rubricOverrides);
        if (Array.isArray(data.groupList)) setGroupList(data.groupList);
        showToast && showToast('과제를 가져왔습니다.');
      } catch { showToast && showToast('가져오기 실패 — 올바른 과제 파일(JSON)이 아닙니다.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };
  const moreItem = { display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', background: 'white', cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)', fontWeight: 600, color: '#1E293B' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#F4F7FB' }}>
      {/* 헤더 + Step indicator — sticky top */}
      <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'white', borderBottom: '1px solid #E2E8F0' }}>
        <header style={{ padding: '1rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 'var(--neo-font-size-xl)', fontWeight: 900, margin: 0 }}>📷 파일 업로드 등록</h1>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={handleExitNoSave} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>나가기</button>
            {/* [v2.2] 공유 버튼을 더보기에서 헤더로 외부 노출 — 1차 액션으로 승격 (TSK-13과 동일) */}
            <button onClick={handleToggleShare}
              title={isShared ? '과제 공유를 취소합니다.' : '과제를 공유합니다.'}
              style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid', borderColor: isShared ? '#2A75F3' : '#E2E8F0', background: isShared ? '#EFF6FF' : 'white', color: isShared ? '#1D4ED8' : '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>🔗 {isShared ? '공유취소' : '공유확인'}</button>
            <button onClick={handleSave} disabled={!canSave}
              title={canSave ? '과제를 저장합니다.' : '파일 업로드와 과제명을 입력해야 저장할 수 있습니다.'}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: canSave ? '#10B981' : '#CBD5E1', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: canSave ? 'pointer' : 'not-allowed' }}>💾 저장</button>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setMoreOpen((o) => !o)} aria-haspopup="true" aria-expanded={moreOpen}
                style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>⋯ 더보기</button>
              {moreOpen && (
                <>
                  <div onClick={() => setMoreOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 41, background: 'white', border: '1px solid #E2E8F0', borderRadius: 10, boxShadow: '0 12px 28px rgba(15,23,42,0.16)', overflow: 'hidden', minWidth: 180 }}>
                    <div style={{ padding: '6px 14px 4px', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#94A3B8', background: '#F8FAFC' }}>과제 파일 관리</div>
                    <button onClick={handleExport} style={moreItem}>↥ 과제 내보내기</button>
                    <button onClick={() => { setMoreOpen(false); importInputRef.current?.click(); }} style={moreItem}>↧ 과제 가져오기</button>
                    <button onClick={() => { setMoreOpen(false); handleDelete(); }} style={{ ...moreItem, color: '#EF4444', borderTop: '1px solid #F1F5F9' }}>🗑 삭제</button>
                  </div>
                </>
              )}
              <input ref={importInputRef} type="file" accept="application/json,.json" onChange={handleImportFile} style={{ display: 'none' }} />
            </div>
          </div>
        </header>
        <div style={{ display: 'flex', alignItems: 'center', padding: '0 1.5rem 14px', gap: 6, overflowX: 'auto' }}>
          {STEPS.map((s, i) => {
            // [v2.14] 클릭 가능: 지난 단계(뒤로) 또는 현재+1 단계(canNext 충족 시)
            const isPast = s.n < step;
            const isNextEnabled = s.n === step + 1 && canNext();
            const clickable = isPast || isNextEnabled;
            return (
            <React.Fragment key={s.n}>
              <button
                onClick={() => {
                  if (!clickable) return;
                  showToast && showToast('저장됨');
                  setStep(s.n);
                }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '7px 14px', borderRadius: '20px', whiteSpace: 'nowrap',
                  border: '1.5px solid',
                  borderColor: step === s.n ? '#2A75F3' : s.n < step ? '#10B981' : '#E2E8F0',
                  background: step === s.n ? '#EFF6FF' : s.n < step ? '#D1FAE5' : 'white',
                  color: step === s.n ? '#1D4ED8' : s.n < step ? '#047857' : '#94A3B8',
                  fontSize: 'var(--neo-font-size-sm)', fontWeight: 800,
                  cursor: clickable ? 'pointer' : 'default',
                }}
              >
                <span>{s.icon}</span>
                <span>{s.n}. {s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <span style={{ color: '#CBD5E1', fontWeight: 800, flexShrink: 0 }}>→</span>
              )}
            </React.Fragment>
            );
          })}
        </div>
        {/* [v3.45] 자율평가 합 불일치 지속 안내 — 모달 닫혀도 항상 표시 */}
        {evalMode === 'self' && (() => {
          const items = getMismatchQuestions();
          if (items.length === 0) return null;
          return (
            <div style={{ background: '#FEF3C7', borderTop: '1px solid #FDE68A', padding: '10px 1.5rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#92400E', fontWeight: 800 }}>⚠ 채점 합계 ≠ 총 배점</span>
              <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#B45309' }}>
                {items.map((m) => `문항 ${m.idx}(${m.diff > 0 ? '+' : ''}${m.diff}점)`).join(' · ')}
              </span>
              <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', marginLeft: 'auto' }}>정합성을 맞춰야 저장됩니다. 브라우저를 그냥 닫으면 자동으로 균등 재분배됩니다.</span>
              <button onClick={() => items.forEach((m) => redistributeTotal(m.qid))}
                style={{ padding: '4px 10px', borderRadius: 8, border: '1px solid #B45309', background: 'white', color: '#B45309', fontWeight: 800, fontSize: 'var(--neo-font-size-xs)', cursor: 'pointer' }}>↻ 모두 균등 재분배</button>
            </div>
          );
        })()}
      </div>

      {/* Step 본문 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>

        {/* Step 1 — 기본 정보 + 파일 업로드 (통합) */}
        {step === 1 && (
          <div style={{ maxWidth: '880px', margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, marginBottom: '6px' }}>📋 Step 1. 기본 정보 · 파일 업로드</h2>
            <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginBottom: '20px' }}>
              과제 기본 정보(과제명·학교급·학년·교과·과목·핵심역량)를 입력하고, 학생에게 보여줄 종이 양식(PDF/PNG/JPG)을 함께 업로드합니다. 핵심평가영역·성취기준·모범답안은 「성취기준」 단계에서 입력합니다.
            </p>

            {/* ① 기본 정보 */}
            <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '16px' }}>
              <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>① 기본 정보</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>문제 유형</label>
                  <select value={basicInfo.type} onChange={(e) => setBasicInfo({ ...basicInfo, type: e.target.value })}
                    style={{ width: '100%', padding: '10px 12px', marginTop: '6px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: 'var(--neo-font-size-base)' }}>
                    <option>서술형</option>
                  </select>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>과제명 *</label>
                    <span style={{ fontSize: 'var(--neo-font-size-xs)', color: basicInfo.title.length >= 100 ? '#EF4444' : '#94A3B8' }}>{basicInfo.title.length}/100</span>
                  </div>
                  <textarea placeholder="예: 2학기 중간고사 모의고사" maxLength={100}
                    value={basicInfo.title}
                    onChange={(e) => setBasicInfo({ ...basicInfo, title: e.target.value.slice(0, 100) })}
                    style={{ width: '100%', minHeight: 64, padding: '10px 12px', marginTop: '6px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: 'var(--neo-font-size-base)', lineHeight: 1.5, resize: 'vertical', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                </div>
                <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>학교급 *</label>
                    <select value={basicInfo.schoolLevel} onChange={(e) => { const schoolLevel = e.target.value; setBasicInfo({ ...basicInfo, schoolLevel, grade: gradesOf(schoolLevel)[0] }); }}
                      style={{ width: '100%', padding: '10px 12px', marginTop: '6px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: 'var(--neo-font-size-base)' }}>
                      <option>초등학교</option><option>중학교</option><option>고등학교</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>학년 *</label>
                    <select value={basicInfo.grade} onChange={(e) => setBasicInfo({ ...basicInfo, grade: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', marginTop: '6px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: 'var(--neo-font-size-base)' }}>
                      {gradesOf(basicInfo.schoolLevel).map((g) => <option key={g}>{g}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>교과 *</label>
                    <select value={basicInfo.subject} onChange={(e) => { const subject = e.target.value; setBasicInfo({ ...basicInfo, subject, subSubject: subjectsOf(subject)[0] || '' }); }}
                      style={{ width: '100%', padding: '10px 12px', marginTop: '6px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: 'var(--neo-font-size-base)' }}>
                      <option>국어</option><option>수학</option><option>영어</option><option>사회</option><option>과학</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>과목</label>
                    <select value={basicInfo.subSubject} onChange={(e) => setBasicInfo({ ...basicInfo, subSubject: e.target.value })}
                      style={{ width: '100%', padding: '10px 12px', marginTop: '6px', border: '1px solid #E2E8F0', borderRadius: '8px', fontSize: 'var(--neo-font-size-base)' }}>
                      {subjectsOf(basicInfo.subject).map((s) => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                {/* [v3.50] 핵심역량 — 기본정보 단계로 이동 (성취기준 단계에서 분리). 선택 교과의 프레임워크에 따라 동적 노출 */}
                <div>
                  <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>핵심 역량 <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>(선택 · 다중)</span></label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {competenciesOf(basicInfo.subject).length === 0 ? (
                      <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>선택한 교과에 정의된 핵심 역량이 없습니다.</span>
                    ) : competenciesOf(basicInfo.subject).map((c) => {
                      const on = basicInfo.competencies.includes(c);
                      const toggleInArray = (key, value) => {
                        const arr = basicInfo[key];
                        const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
                        setBasicInfo({ ...basicInfo, [key]: next });
                      };
                      return (
                        <button key={c} onClick={() => toggleInArray('competencies', c)} style={{
                          padding: '6px 12px', borderRadius: '16px',
                          border: '1.5px solid', borderColor: on ? '#2A75F3' : '#E2E8F0',
                          background: on ? '#EFF6FF' : 'white', color: on ? '#1D4ED8' : '#475569',
                          fontSize: 'var(--neo-font-size-sm)', fontWeight: on ? 800 : 600, cursor: 'pointer',
                        }}>{on ? '✓ ' : ''}{c}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* ② 파일 업로드 */}
            <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '20px', marginBottom: '16px' }}>
              <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B', marginBottom: '10px' }}>② 파일 업로드 <span style={{ color: '#EF4444', fontWeight: 700 }}>*</span></div>
              {!uploadedFile ? (
                <label style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  padding: '40px 20px', border: '2px dashed #CBD5E1', borderRadius: '12px',
                  background: '#F8FAFC', cursor: 'pointer', gap: '10px',
                }}>
                  <span style={{ fontSize: '2.4rem' }}>📁</span>
                  <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>
                    파일을 드래그하거나 클릭하여 업로드
                  </span>
                  <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>
                    PDF, PNG, JPG · 최대 10MB
                  </span>
                  {pdfLoading && (
                    <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#2A75F3', fontWeight: 700 }}>
                      {pdfLoadProgress
                        ? `⏳ PDF 페이지 ${pdfLoadProgress.current}/${pdfLoadProgress.total} 로딩 중...`
                        : '⏳ PDF 로딩 중...'}
                    </span>
                  )}
                  <input type="file" accept="application/pdf,image/png,image/jpeg"
                    onChange={(e) => handleFileUpload(e.target.files[0])}
                    style={{ display: 'none' }} />
                </label>
              ) : (
                <div style={{
                  padding: '16px 20px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: '10px',
                  display: 'flex', alignItems: 'center', gap: '12px',
                }}>
                  <span style={{ fontSize: '1.6rem' }}>{uploadedFile.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, color: '#1E293B' }}>{uploadedFile.name}</div>
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>
                      {(uploadedFile.size / 1024).toFixed(1)} KB · {uploadedFile.type}
                      {totalPages > 1 && <> · <strong style={{ color: '#0EA5E9' }}>총 {totalPages}페이지</strong></>}
                    </div>
                  </div>
                  <label style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #CBD5E1', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>
                    파일 변경
                    <input type="file" accept="application/pdf,image/png,image/jpeg"
                      onChange={(e) => handleFileUpload(e.target.files[0])}
                      style={{ display: 'none' }} />
                  </label>
                  <button onClick={handleRemoveFile}
                    style={{ padding: '6px 12px', borderRadius: '8px', border: '1px solid #FECACA', background: 'white', color: '#DC2626', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>제거</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2 — 영역 편집 */}
        {step === 2 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
              <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, margin: 0 }}>🎯 Step 2. 영역 편집</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <button
                  onClick={() => setSnapEnabled(v => !v)}
                  title="이동·리사이즈 시 그리드 및 인접 영역에 자동 정렬. Shift 누르면 일시 비활성"
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1.5px solid', borderColor: snapEnabled ? '#06B6D4' : '#CBD5E1',
                    background: snapEnabled ? '#ECFEFF' : 'white',
                    color: snapEnabled ? '#0E7490' : '#475569',
                    fontSize: 'var(--neo-font-size-sm)', fontWeight: 800,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >📐 스냅 {snapEnabled ? 'ON' : 'OFF'}</button>
                <button
                  onClick={undo}
                  disabled={history.length === 0}
                  title="Ctrl+Z (Mac: ⌘+Z)"
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid', borderColor: history.length === 0 ? '#E2E8F0' : '#CBD5E1',
                    background: history.length === 0 ? '#F8FAFC' : 'white',
                    color: history.length === 0 ? '#CBD5E1' : '#475569',
                    fontSize: 'var(--neo-font-size-sm)', fontWeight: 700,
                    cursor: history.length === 0 ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >↶ 실행 취소 <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>(Ctrl+Z)</span></button>
                <button
                  onClick={duplicateSelected}
                  disabled={!selectedAreaId}
                  title="Ctrl+D (Mac: ⌘+D)"
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid', borderColor: !selectedAreaId ? '#E2E8F0' : '#CBD5E1',
                    background: !selectedAreaId ? '#F8FAFC' : 'white',
                    color: !selectedAreaId ? '#CBD5E1' : '#475569',
                    fontSize: 'var(--neo-font-size-sm)', fontWeight: 700,
                    cursor: !selectedAreaId ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >⎘ 복제 <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>(Ctrl+D)</span></button>
                <button
                  onClick={() => selectedAreaId && deleteArea(selectedAreaId)}
                  disabled={!selectedAreaId}
                  title="Delete / Backspace"
                  style={{
                    padding: '6px 12px', borderRadius: '8px',
                    border: '1px solid', borderColor: !selectedAreaId ? '#E2E8F0' : '#FECACA',
                    background: !selectedAreaId ? '#F8FAFC' : 'white',
                    color: !selectedAreaId ? '#CBD5E1' : '#DC2626',
                    fontSize: 'var(--neo-font-size-sm)', fontWeight: 700,
                    cursor: !selectedAreaId ? 'not-allowed' : 'pointer',
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}
                >🗑 삭제 <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>(Del)</span></button>
              </div>
            </div>
            <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginBottom: '12px' }}>
              빈 공간을 드래그하여 새 영역을 그리거나, 기존 영역을 선택한 뒤 본체 드래그(이동) · 모서리 핸들 드래그(크기 조절) · <strong>Ctrl+D</strong>(복제) · <strong>Del</strong>(삭제) · <strong>Ctrl+Z</strong>(취소)로 편집할 수 있습니다. <strong>Ctrl/⌘ + 마우스 휠</strong>로 캔버스 영역을 확대/축소할 수 있습니다 (25%~400%).
              {snapEnabled && <> 이동·리사이즈 시 그리드와 인접 영역 모서리에 <strong style={{ color: '#0E7490' }}>자동 정렬(스냅)</strong>되며, <strong>Shift</strong> 키를 누르면 일시 비활성됩니다.</>}
              <strong style={{ color: '#2A75F3' }}> 문항 영역 1~3개</strong>가 필수이고(묶음 1개 = 1로 카운트),
              <strong style={{ color: '#94A3B8' }}> 지문 영역</strong>은 선택이지만 1개를 초과할 수 없습니다 (여러 페이지에 걸친 지문이면 [🔗 합치기]로 묶어 1개로 만드세요).
            </p>

            {/* [v2.77] 슬롯 검증 안내 배너 — 지문 ≤ 1, 문항 1~3 */}
            {(() => {
              const qSlots = computeAreaGroups(areas.filter(a => a.type === 'question')).length;
              const pSlots = computeAreaGroups(areas.filter(a => a.type === 'passage')).length;
              const issues = [];
              if (qSlots === 0) issues.push({ icon: '🟦', msg: '문항이 0개입니다. 1개 이상 영역을 그려야 다음 단계로 진행할 수 있습니다.' });
              if (qSlots > 3) issues.push({ icon: '🟦', msg: `문항이 ${qSlots}개입니다. 최대 3개까지만 가능합니다. 한 문항이 여러 영역으로 인식된 경우 [🔗 합치기]로 묶어 주세요.` });
              if (pSlots > 1) issues.push({ icon: '🟫', msg: `지문이 ${pSlots}개입니다. 지문은 1개여야 합니다. 한 지문이 여러 페이지에 걸친 경우 [🔗 합치기]로 묶어 주세요.` });
              if (issues.length === 0) return null;
              return (
                <div style={{
                  background: '#FEF3C7', border: '1.5px solid #F59E0B',
                  borderRadius: '10px', padding: '10px 14px', marginBottom: '14px',
                  fontSize: 'var(--neo-font-size-sm)', color: '#78350F', lineHeight: 1.55,
                }}>
                  <div style={{ fontWeight: 800, marginBottom: '4px' }}>⚠️ 다음 단계로 진행할 수 없습니다</div>
                  {issues.map((iss, i) => (
                    <div key={i} style={{ marginTop: i === 0 ? 0 : '4px' }}>
                      <strong>{iss.icon}</strong> {iss.msg}
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* OCR 자동 감지 안내 배너 — [v2.10] 다시 실행 버튼 항상 노출. 안내 텍스트만 자동 감지 영역 유무로 분기 */}
            <div style={{
              marginBottom: '14px', padding: '10px 14px',
              background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: '10px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
              fontSize: 'var(--neo-font-size-sm)', color: '#1D4ED8', fontWeight: 600,
            }}>
              <span>
                {areas.some(a => a.autoDetected) ? (
                  <>🤖 <strong>{areas.filter(a => a.autoDetected).length}개</strong>가 자동으로 감지되었습니다. 잘못된 영역을 클릭하여 수정하거나 전체를 삭제하고 처음부터 다시 그릴 수 있습니다.</>
                ) : (
                  <>🤖 자동 감지 영역을 다시 실행할 수 있습니다. 필요 시 사용해 주세요.</>
                )}
              </span>
              <button
                onClick={() => {
                  if (window.confirm('자동 감지를 다시 실행합니다.\n\n현재 모든 영역(이름 변경·추가·이동·삭제 포함)이 폐기되고 OCR이 재실행됩니다. 사용자가 편집한 내용은 사라집니다.\n\n계속하시겠습니까?')) {
                    setAreas([]);
                    setStep(1);
                    runOcrDetection();
                  }
                }}
                style={{
                  padding: '6px 12px', borderRadius: '8px',
                  border: '1px solid #BFDBFE', background: 'white',
                  color: '#1D4ED8', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >🤖 자동 감지 다시 실행</button>
            </div>

            {/* [v2.80] 페이지 네비게이션 폐기 — 세로 스크롤 방식으로 전환. 다중 페이지면 안내만 노출 */}
            {totalPages > 1 && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 14px', marginBottom: '12px',
                background: '#F1F5F9', borderRadius: '10px', border: '1px solid #E2E8F0',
                fontSize: 'var(--neo-font-size-sm)', color: '#475569',
              }}>
                📄 <strong>총 {totalPages}페이지</strong> · 세로 스크롤로 모든 페이지를 한 화면에서 확인·편집할 수 있습니다. 우측 영역 목록에서 영역을 클릭하면 해당 페이지로 자동 스크롤됩니다.
              </div>
            )}

            {/* 영역 타입 선택 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#64748B', alignSelf: 'center', marginRight: '4px' }}>그릴 영역 타입:</span>
              {AREA_TYPES.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveAreaType(t.id)}
                  style={{
                    padding: '6px 14px', borderRadius: '20px',
                    border: '1.5px solid', borderColor: activeAreaType === t.id ? t.color : '#E2E8F0',
                    background: activeAreaType === t.id ? t.color + '20' : 'white',
                    color: activeAreaType === t.id ? t.color : '#475569',
                    fontSize: 'var(--neo-font-size-sm)', fontWeight: activeAreaType === t.id ? 800 : 600,
                    cursor: 'pointer',
                  }}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px' }}>
              {/* 좌측 캔버스 — [v2.80] 세로 스크롤 컨테이너 + 페이지마다 SVG 분리 / [v2.81] Ctrl+휠 줌 */}
              <div
                ref={canvasScrollRef}
                style={{
                  background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px',
                  padding: '12px',
                  maxHeight: '78vh', overflowY: 'auto', overflowX: 'auto',
                  display: 'flex', flexDirection: 'column', gap: '20px',
                  position: 'relative',
                }}
              >
                {/* [v2.81] 줌 표시기 + 리셋 — 캔버스 우상단 floating */}
                {uploadedFile?.pages?.length > 0 && (
                  <div style={{
                    position: 'sticky', top: 0, alignSelf: 'flex-end',
                    display: 'inline-flex', alignItems: 'center', gap: '4px',
                    background: 'rgba(15, 23, 42, 0.85)', color: 'white',
                    padding: '4px 8px', borderRadius: '6px',
                    fontSize: 'var(--neo-font-size-xs)', fontWeight: 800,
                    zIndex: 5, marginBottom: '-12px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                  }}
                  title="Ctrl + 마우스 휠로 확대/축소"
                  >
                    <button
                      onClick={() => setZoom(z => Math.max(MIN_ZOOM, Math.round((z - 0.1) * 100) / 100))}
                      disabled={zoom <= MIN_ZOOM}
                      style={{ background: 'transparent', border: 'none', color: 'white', cursor: zoom <= MIN_ZOOM ? 'not-allowed' : 'pointer', fontSize: 'var(--neo-font-size-base)', padding: '0 4px', opacity: zoom <= MIN_ZOOM ? 0.4 : 1 }}
                    >−</button>
                    <span style={{ minWidth: '36px', textAlign: 'center' }}>🔍 {Math.round(zoom * 100)}%</span>
                    <button
                      onClick={() => setZoom(z => Math.min(MAX_ZOOM, Math.round((z + 0.1) * 100) / 100))}
                      disabled={zoom >= MAX_ZOOM}
                      style={{ background: 'transparent', border: 'none', color: 'white', cursor: zoom >= MAX_ZOOM ? 'not-allowed' : 'pointer', fontSize: 'var(--neo-font-size-base)', padding: '0 4px', opacity: zoom >= MAX_ZOOM ? 0.4 : 1 }}
                    >＋</button>
                    {zoom !== 1 && (
                      <button
                        onClick={() => setZoom(1)}
                        title="100%로 리셋"
                        style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: 'white', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', padding: '1px 6px', borderRadius: '4px', marginLeft: '2px' }}
                      >리셋</button>
                    )}
                  </div>
                )}
                {!uploadedFile?.pages?.length && (
                  <div style={{
                    padding: '40px 20px', textAlign: 'center',
                    background: '#FAFAFA', borderRadius: '8px', color: '#CBD5E1',
                    fontWeight: 700,
                  }}>파일을 먼저 업로드해 주세요</div>
                )}
                {uploadedFile?.pages?.map((pageData, pageIdx) => {
                  const pageNum = pageIdx + 1;
                  const vbW = pageData.width;
                  const vbH = pageData.height;
                  const pageAreas = areas.filter(a => (a.page || 1) === pageNum);
                  const isActivePage = currentPage === pageNum;
                  return (
                    <div key={pageNum} id={`tsk12-page-${pageNum}`}>
                      {/* 페이지 헤더 */}
                      {totalPages > 1 && (
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '8px',
                          padding: '6px 10px', marginBottom: '6px',
                          background: isActivePage ? '#EFF6FF' : '#F8FAFC',
                          border: `1px solid ${isActivePage ? '#BFDBFE' : '#E2E8F0'}`,
                          borderRadius: '6px',
                        }}>
                          <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: isActivePage ? '#1D4ED8' : '#475569' }}>
                            📄 페이지 {pageNum} / {totalPages}
                          </span>
                          <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>
                            영역 {pageAreas.length}개
                          </span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <svg
                          ref={(el) => { if (el) drawRefs.current[pageNum] = el; }}
                          viewBox={`0 0 ${vbW} ${vbH}`}
                          preserveAspectRatio="xMidYMid meet"
                          style={{
                            // [v2.81] zoom 적용 — 기본 600px × zoom. 줌 인 시 가로 스크롤 활성
                            width: `${600 * zoom}px`,
                            maxWidth: `${600 * zoom}px`,
                            height: 'auto',
                            flexShrink: 0,
                            background: '#FAFAFA',
                            cursor: interaction?.mode === 'move' ? 'move' : (interaction?.mode === 'resize' ? 'nwse-resize' : 'crosshair'),
                            userSelect: 'none',
                          }}
                          onMouseEnter={() => setCurrentPage(pageNum)}
                          onMouseDown={handleMouseDown}
                          onMouseMove={handleMouseMove}
                          onMouseUp={handleMouseUp}
                          onMouseLeave={() => { setDrawing(null); setInteraction(null); }}
                        >
                          {/* 배경 이미지 */}
                          <image href={pageData.dataUrl} x="0" y="0" width={vbW} height={vbH} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />

                          {/* 영역들 */}
                          {pageAreas.map(a => {
                            const t = AREA_TYPES.find(x => x.id === a.type);
                            const isSelected = selectedAreaId === a.id;
                            const labelFontSize = Math.max(12, vbW * 0.014);
                            const labelHeight = labelFontSize * 1.6;
                            const dashed = isSelected ? '6 3' : 'none';
                            const hSize = Math.max(8, vbW * 0.012);
                            const corners = [
                              { id: 'nw', cx: a.rect.x,              cy: a.rect.y,             cursor: 'nwse-resize' },
                              { id: 'ne', cx: a.rect.x + a.rect.w,   cy: a.rect.y,             cursor: 'nesw-resize' },
                              { id: 'sw', cx: a.rect.x,              cy: a.rect.y + a.rect.h,  cursor: 'nesw-resize' },
                              { id: 'se', cx: a.rect.x + a.rect.w,   cy: a.rect.y + a.rect.h,  cursor: 'nwse-resize' },
                            ];
                            // [v2.85] 슬롯 한도 거부 흔들기 대상 여부
                            //   흔들림 폭은 viewBox user unit 기준이라 페이지 폭에 비례시킨다(vbW의 1%).
                            //   key에 shakeSeq를 섞어 연속 시도 시 애니메이션이 처음부터 재생되게 한다.
                            const isShaking = shakeAreaIds.includes(a.id);
                            return (
                              <g
                                key={isShaking ? `${a.id}-shake-${shakeSeq}` : a.id}
                                className={isShaking ? 'tsk12-area-shake' : undefined}
                                style={isShaking ? { '--tsk12-shake-dx': `${vbW * 0.01}px` } : undefined}
                              >
                                <rect
                                  data-area-id={a.id}
                                  x={a.rect.x} y={a.rect.y} width={a.rect.w} height={a.rect.h}
                                  fill={t.fill} stroke={t.stroke}
                                  strokeWidth={isSelected ? 3 : 1.5}
                                  strokeDasharray={dashed}
                                  onClick={(e) => { e.stopPropagation(); setSelectedAreaId(a.id); }}
                                  // [v2.66] 겹침 허용 조합에선 이동(move)이 아니라 그리기(crosshair) 커서 노출
                                  //   → 사용자가 이 영역 위에서 새 image 영역을 그릴 수 있음을 시각 힌트로 제공
                                  style={{ cursor: overlapAllowedBetween(activeAreaType, a.type) ? 'crosshair' : 'move' }}
                                />
                                <rect
                                  x={a.rect.x} y={a.rect.y - labelHeight} width={Math.min(a.rect.w, vbW * 0.28)} height={labelHeight}
                                  fill={t.stroke} rx="3"
                                  style={{ pointerEvents: 'none' }}
                                />
                                <text
                                  x={a.rect.x + 6} y={a.rect.y - labelHeight * 0.3}
                                  fontSize={labelFontSize} fill="white" fontWeight="800"
                                  style={{ pointerEvents: 'none' }}
                                >
                                  {a.autoDetected ? '🤖 ' : ''}{t.icon} {a.name}
                                  {a.group && (() => {
                                    const sameGroup = areas.filter(x => x.group?.id === a.group.id)
                                      .sort((x, y) => (x.group?.partIndex || 0) - (y.group?.partIndex || 0));
                                    const myIdx = a.group.partIndex || 1;
                                    const total = a.group.totalParts || sameGroup.length;
                                    const nextPart = sameGroup[myIdx];
                                    const prevPart = sameGroup[myIdx - 2];
                                    const tail = nextPart
                                      ? ` · ↓ p${nextPart.page || 1}로 이어짐`
                                      : (prevPart ? ` · ↑ p${prevPart.page || 1}에서 이어짐` : '');
                                    return ` 🔗 (${myIdx}/${total}${tail})`;
                                  })()}
                                </text>
                                {/* [v2.85] 거부 글로우 — 빨간 테두리. 모션을 끈 환경(prefers-reduced-motion)에서도
                                    이 글로우는 유지되어 「불가」 피드백이 사라지지 않는다. */}
                                {isShaking && (
                                  <rect
                                    className="tsk12-area-shake-glow"
                                    x={a.rect.x} y={a.rect.y} width={a.rect.w} height={a.rect.h}
                                    fill="none" stroke="#DC2626" strokeWidth={Math.max(3, vbW * 0.005)}
                                    rx="2"
                                  />
                                )}
                                {isSelected && corners.map(c => (
                                  <rect
                                    key={c.id}
                                    data-area-id={a.id}
                                    data-handle={c.id}
                                    x={c.cx - hSize / 2} y={c.cy - hSize / 2}
                                    width={hSize} height={hSize}
                                    fill="#06B6D4" stroke="white" strokeWidth={Math.max(1, vbW * 0.0015)}
                                    style={{ cursor: c.cursor }}
                                  />
                                ))}
                              </g>
                            );
                          })}

                          {/* 그리기 중인 사각형 — 현재 마우스가 진입한 페이지에서만 노출 */}
                          {drawing && isActivePage && (() => {
                            const x = Math.min(drawing.startX, drawing.currentX);
                            const y = Math.min(drawing.startY, drawing.currentY);
                            const w = Math.abs(drawing.currentX - drawing.startX);
                            const h = Math.abs(drawing.currentY - drawing.startY);
                            const t = AREA_TYPES.find(x => x.id === activeAreaType);
                            const sw = Math.max(2, vbW * 0.003);
                            return (
                              <rect x={x} y={y} width={w} height={h}
                                fill={t.fill} stroke={t.stroke} strokeWidth={sw}
                                strokeDasharray={`${sw*2} ${sw}`}
                                style={{ pointerEvents: 'none' }}
                              />
                            );
                          })()}
                        </svg>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 우측 사이드바 — 영역 list */}
              <div style={{
                background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px',
                padding: '14px', maxHeight: '70vh', overflowY: 'auto',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  {/* [v2.74 → v2.77] 문항·지문 카운트 모두 묶음 단위 — 1 그룹 = 1 슬롯. 정책: 문항 1~3, 지문 0~1 */}
                  {(() => {
                    const groups = computeAreaGroups(areas);
                    const questionSlots = groups.filter(g => g.firstArea.type === 'question').length;
                    const passageSlots = groups.filter(g => g.firstArea.type === 'passage').length;
                    const qColor = (questionSlots >= 1 && questionSlots <= 3) ? '#10B981' : '#DC2626';
                    const pColor = passageSlots <= 1 ? '#10B981' : '#DC2626';
                    // [v2.85] 슬롯 한도 거부 시 카운트 배지도 함께 흔들어 「3/3이라 더 못 만든다」를 연결
                    const badgeShaking = shakeAreaIds.length > 0;
                    return (
                      <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800 }}>
                        영역 목록 ({areas.length}) ·{' '}
                        <span
                          key={badgeShaking ? `q-shake-${shakeSeq}` : 'q'}
                          className={badgeShaking ? 'tsk12-badge-shake' : undefined}
                          style={{ fontSize: 'var(--neo-font-size-sm)', color: badgeShaking ? '#DC2626' : qColor }}
                        >문항 {questionSlots}/3</span>
                        {' · '}
                        <span style={{ fontSize: 'var(--neo-font-size-sm)', color: pColor }}>지문 {passageSlots}/1</span>
                      </span>
                    );
                  })()}
                  {areas.length > 0 && (
                    <button
                      onClick={() => { if (window.confirm('모든 영역을 삭제하시겠습니까?')) { setAreas([]); setSelectedAreaId(null); clearAllChecked(); setExpandedAreaIds(new Set()); closeLinkModal(); } }}
                      style={{ padding: '4px 10px', borderRadius: '6px', border: '1px solid #FECACA', background: 'white', color: '#DC2626', fontWeight: 700, fontSize: 'var(--neo-font-size-xs)', cursor: 'pointer' }}
                    >전체 삭제</button>
                  )}
                </div>

                {/* [v2.80] 일괄 액션 바 — 체크박스 1개 이상 선택 시 노출. 삭제(1+) / 합치기(2+ 같은 type) */}
                {checkedAreaIds.size > 0 && (() => {
                  const linkEnabled = checkedAreaIds.size >= 2 && checkedAreasSameType;
                  const linkBtnTitle = checkedAreaIds.size < 2
                    ? '2개 이상 선택해야 합치기 가능'
                    : (!checkedAreasSameType ? '같은 타입(문항끼리·지문끼리)만 합칠 수 있습니다' : `${checkedAreaIds.size}개 영역 합치기`);
                  return (
                    <div style={{
                      background: '#EFF6FF', border: '1.5px solid #BFDBFE',
                      borderRadius: '8px', padding: '8px 10px', marginBottom: '10px',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
                    }}>
                      <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1D4ED8' }}>
                        {checkedAreaIds.size}개 선택됨
                      </span>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        {/* [v2.83] [선택 해제] 버튼 폐기 — 체크박스 클릭으로 직접 해제 */}
                        <button
                          onClick={bulkLinkChecked}
                          disabled={!linkEnabled}
                          title={linkBtnTitle}
                          style={{
                            padding: '4px 10px', borderRadius: '6px',
                            border: '1px solid',
                            borderColor: linkEnabled ? '#2A75F3' : '#E2E8F0',
                            background: linkEnabled ? '#2A75F3' : '#F1F5F9',
                            color: linkEnabled ? 'white' : '#94A3B8',
                            fontWeight: 700, fontSize: 'var(--neo-font-size-xs)',
                            cursor: linkEnabled ? 'pointer' : 'not-allowed',
                          }}
                        >🔗 합치기</button>
                        <button
                          onClick={bulkDeleteChecked}
                          title={`${checkedAreaIds.size}개 영역 삭제`}
                          style={{
                            padding: '4px 10px', borderRadius: '6px',
                            border: '1px solid #DC2626',
                            background: '#DC2626', color: 'white',
                            fontWeight: 700, fontSize: 'var(--neo-font-size-xs)', cursor: 'pointer',
                          }}
                        >🗑️ 삭제</button>
                      </div>
                    </div>
                  );
                })()}
                {areas.length === 0 ? (
                  <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94A3B8', fontSize: 'var(--neo-font-size-sm)' }}>
                    아직 정의된 영역이 없습니다.<br />좌측 캔버스에서 드래그하여 영역을 그려주세요.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {/* [v2.75] 묶음 단위 그루핑 — 박스 안의 박스 구조. 단독 영역은 평면 카드 그대로 */}
                    {computeAreaGroups(areas).map((g) => {
                      const firstArea = g.firstArea;
                      const tMeta = AREA_TYPES.find(x => x.id === firstArea.type);
                      const isMultiPartGroup = !!g.groupId && g.areas.length > 1;
                      if (!isMultiPartGroup) {
                        return <AreaCardRenderer key={firstArea.id} area={firstArea} t={tMeta} isInGroup={false} />;
                      }
                      return (
                        <div key={g.groupId} style={{
                          border: `2px solid ${tMeta.stroke}`,
                          borderRadius: '12px',
                          background: `${tMeta.stroke}10`,
                          padding: '8px',
                          display: 'flex', flexDirection: 'column', gap: '6px',
                        }}>
                          {/* 묶음 헤더 */}
                          <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            gap: '6px', padding: '2px 6px 4px',
                          }}>
                            <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: tMeta.stroke, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              🔗 {firstArea.name}
                              <span style={{ color: '#94A3B8', fontWeight: 600 }}>· {g.areas.length}개 part 묶음</span>
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`「${firstArea.name}」 묶음 전체를 해제하시겠습니까? (각 part가 별도 영역이 됩니다)`)) {
                                  pushHistory(areas);
                                  const updated = areas.map(a => g.areas.some(x => x.id === a.id) ? { ...a, group: null, customName: false } : a);
                                  setAreas(sortAndRenumber(updated));
                                }
                              }}
                              title="묶음 전체 해제"
                              style={{ padding: '2px 8px', borderRadius: '4px', border: `1px solid ${tMeta.stroke}`, background: 'white', color: tMeta.stroke, cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700 }}
                            >🔗✕ 묶음 해제</button>
                          </div>
                          {/* 묶음 안 part 카드들 */}
                          {g.areas.map(a => <AreaCardRenderer key={a.id} area={a} t={tMeta} isInGroup={true} />)}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 영역 타입별 카운트 요약 — 문항(필수) · 지문(선택) · 이미지(선택, 겹침 허용) */}
                <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px dashed #E2E8F0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {AREA_TYPES.map(t => {
                    const count = areas.filter(a => a.type === t.id).length;
                    const isRequired = t.id === 'question';
                    const hasIssue = isRequired && count === 0;
                    const suffix = isRequired ? ' *' : (t.overlapAllowed ? ' (겹침 허용)' : ' (선택)');
                    return (
                      <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--neo-font-size-sm)', color: hasIssue ? '#DC2626' : '#475569' }}>
                        <span>{t.icon} {t.label}{suffix}</span>
                        <span style={{ fontWeight: 800 }}>{count}개{hasIssue ? ' ⚠' : ''}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* [v2.75] 묶기 모달 — 같은 type 영역 다중 체크박스 선택 */}
            {linkModalFromAreaId && (() => {
              const from = areas.find(a => a.id === linkModalFromAreaId);
              if (!from) return null;
              const tMeta = AREA_TYPES.find(t => t.id === from.type);
              // 같은 type 영역들 (자기 자신 + 후보 모두 노출)
              const candidates = areas.filter(a => a.type === from.type);
              // 이미 from과 같은 묶음에 있는 영역은 자동 선택 표시 (해제 불가)
              const fromGroupId = from.group?.id;
              return (
                <div
                  onClick={closeLinkModal}
                  style={{
                    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
                  }}
                >
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: 'white', borderRadius: '14px', width: '100%', maxWidth: '560px',
                      maxHeight: '80vh', display: 'flex', flexDirection: 'column',
                      boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
                    }}
                  >
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid #E2E8F0' }}>
                      <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B', display: 'flex', alignItems: 'center', gap: 6 }}>
                        🔗 「{from.name}」과(와) 묶을 영역 선택
                      </div>
                      <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginTop: '4px' }}>
                        같은 <strong>{tMeta?.label}</strong> 영역만 선택할 수 있습니다. 선택한 모든 영역이 한 묶음으로 결합됩니다.
                      </div>
                    </div>
                    <div style={{ padding: '12px 20px', overflowY: 'auto', flex: 1 }}>
                      {candidates.map(a => {
                        const isSelf = a.id === from.id;
                        const isAlreadyInSameGroup = fromGroupId && a.group?.id === fromGroupId;
                        const otherGroupId = a.group?.id && a.group.id !== fromGroupId;
                        const checked = isSelf || isAlreadyInSameGroup || linkModalSelectedIds.has(a.id);
                        const preview = (a.ocrText || '').slice(0, 50);
                        return (
                          <label
                            key={a.id}
                            style={{
                              display: 'flex', alignItems: 'flex-start', gap: '10px',
                              padding: '10px 12px', borderRadius: '8px',
                              border: '1px solid',
                              borderColor: checked ? tMeta?.stroke : '#E2E8F0',
                              background: isSelf ? '#F1F5F9' : (checked ? `${tMeta?.stroke}10` : 'white'),
                              cursor: (isSelf || otherGroupId) ? 'not-allowed' : 'pointer',
                              opacity: (isSelf || otherGroupId) ? 0.65 : 1,
                              marginBottom: '6px',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={isSelf || isAlreadyInSameGroup || !!otherGroupId}
                              onChange={() => toggleLinkModalSelection(a.id)}
                              style={{ marginTop: '2px', width: 16, height: 16, accentColor: tMeta?.stroke || '#2A75F3' }}
                            />
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1E293B' }}>
                                <span title={`${a.page || 1}페이지`} style={{
                                  fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#0369A1',
                                  background: '#E0F2FE', border: '1px solid #BAE6FD',
                                  padding: '1px 6px', borderRadius: '999px',
                                }}>p{a.page || 1}</span>
                                {a.name}
                                {isSelf && <span style={{ color: '#94A3B8', fontWeight: 600, fontSize: 'var(--neo-font-size-xs)' }}>· 시작점 (현재)</span>}
                                {isAlreadyInSameGroup && !isSelf && <span style={{ color: '#92400E', fontWeight: 700, fontSize: 'var(--neo-font-size-xs)' }}>· 이미 같은 묶음</span>}
                                {otherGroupId && <span style={{ color: '#DC2626', fontWeight: 700, fontSize: 'var(--neo-font-size-xs)' }}>· 다른 묶음 (해제 후 선택)</span>}
                              </div>
                              {preview && (
                                <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', marginTop: '4px', lineHeight: 1.4 }}>
                                  &ldquo;{preview}{(a.ocrText || '').length > 50 ? '…' : ''}&rdquo;
                                </div>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                    <div style={{ padding: '12px 20px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', fontWeight: 600 }}>
                        {linkModalSelectedIds.size > 0 ? `${linkModalSelectedIds.size}개 선택됨` : '결합할 영역을 선택하세요'}
                      </span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={closeLinkModal} style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #CBD5E1', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>취소</button>
                        <button
                          onClick={confirmLinkModal}
                          disabled={linkModalSelectedIds.size === 0}
                          style={{
                            padding: '8px 18px', borderRadius: '8px', border: 'none',
                            background: linkModalSelectedIds.size === 0 ? '#CBD5E1' : (tMeta?.stroke || '#2A75F3'),
                            color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)',
                            cursor: linkModalSelectedIds.size === 0 ? 'not-allowed' : 'pointer',
                          }}
                        >🔗 묶기 ({linkModalSelectedIds.size + 1}개)</button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Step 3 — 문항 입력 (영역에서 읽어들인 문항 내용 확인·수정 + 모범답안) */}
        {step === 3 && (() => {
          const areaById = Object.fromEntries(areas.map((a) => [a.id, a]));
          // 에디터 툴바 버튼 공통 스타일
          const tbBtn = { width: 26, height: 26, border: '1px solid transparent', background: 'transparent', borderRadius: 4, cursor: 'pointer', color: '#475569', fontSize: 'var(--neo-font-size-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 };
          const tbSep = { width: 1, height: 14, background: '#E2E8F0', margin: '0 3px' };
          // OCR 재실행 — 해당 문항의 영역 이미지를 OCR 엔진에 다시 보내 텍스트 재인식 (현재 stub)
          const pasteOcrSample = (qid) => {
            const idx = questions.findIndex((q) => q.id === qid);
            const sample = OCR_STUB_SAMPLES[idx % OCR_STUB_SAMPLES.length];
            updateQuestion(qid, { content: sample });
            showToast && showToast(`문항 ${idx + 1}의 원본 영역에서 OCR을 다시 실행했습니다. (현재 stub — 실제 연동 시 원본 이미지에서 직접 인식)`);
          };
          const effectiveActiveId = (questions.find((qq) => qq.id === activeQId)?.id) ?? questions[0]?.id;
          const activeIdx = questions.findIndex((qq) => qq.id === effectiveActiveId);
          const activeQ = questions[activeIdx];
          return (
          <div style={{ maxWidth: '880px', margin: '0 auto' }}>
            <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, marginBottom: '8px' }}>📝 Step 3. 문항 입력</h2>
            <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginBottom: '16px' }}>
              「영역 편집」에서 잡은 <strong>「문항」 영역 수만큼 탭이 자동 활성화</strong>되고, 각 영역의 OCR 인식 결과가 <strong>본문 편집기에 자동 반영</strong>됩니다. [🖼 원본 보기]로 원본과 대조하거나 [📋 OCR 다시 실행]으로 재인식할 수 있습니다. 모범답안은 다음 「성취기준」 단계에서 입력합니다.
              <span style={{ color: '#94A3B8' }}> (현재 OCR은 stub — 샘플 텍스트로 시뮬레이션됩니다.)</span>
            </p>

            {/* [v2.76] 지문 카드 리스트 — 자동 감지된 지문 OCR 텍스트를 read-only로 노출 */}
            {(() => {
              const passageGroups = computeAreaGroups(areas.filter(a => a.type === 'passage'));
              if (passageGroups.length === 0) return null;
              return (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>🟫 지문 ({passageGroups.length})</span>
                    <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>자동 감지된 지문 OCR 결과 · 읽기 전용</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {passageGroups.map((g) => {
                      const first = g.firstArea;
                      const isMultiPartGroup = !!g.groupId && g.areas.length > 1;
                      const text = isMultiPartGroup
                        ? joinedGroupOcrText(g.groupId)
                        : (first.ocrText || '');
                      const pageLabel = isMultiPartGroup
                        ? `p${g.areas.map(a => a.page || 1).join('+p')}`
                        : `p${first.page || 1}`;
                      return (
                        <div key={g.groupId || first.id} style={{
                          background: '#F8FAFC', border: '1px solid #E2E8F0',
                          borderLeft: '4px solid #94A3B8', borderRadius: 8, padding: '10px 14px',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                            <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>
                              🟫 {first.name}
                            </span>
                            <span title={isMultiPartGroup ? '여러 페이지에 걸친 묶음 지문' : '단일 페이지 지문'} style={{
                              fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#0369A1',
                              background: '#E0F2FE', border: '1px solid #BAE6FD',
                              padding: '1px 6px', borderRadius: '999px',
                            }}>{pageLabel}</span>
                            {isMultiPartGroup && (
                              <span style={{
                                fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#92400E',
                                background: '#FEF3C7', border: '1px solid #FBBF24',
                                padding: '1px 6px', borderRadius: '999px',
                              }}>🔗 {g.areas.length}개 part</span>
                            )}
                          </div>
                          {text ? (
                            <div style={{
                              fontSize: 'var(--neo-font-size-sm)', color: '#1E293B', lineHeight: 1.6,
                              whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            }}>
                              {text}
                            </div>
                          ) : (
                            <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8', fontStyle: 'italic' }}>
                              (OCR 인식 텍스트 없음 — Step 2 영역 편집에서 [🖼 원본 보기]로 직접 확인하거나 [🤖 자동 감지 다시 실행])
                            </div>
                          )}
                          {/* [v2.66] 지문 내부의 이미지 영역을 실제로 crop 하여 인라인 표시
                              · 원본 페이지 이미지에서 CSS 마스크로 좌표 crop
                              · 배경 렌더에는 캔버스 불필요, 성능 부담 없음 */}
                          {(() => {
                            // 지문 묶음(part) 각각에 포함된 이미지 영역 수집
                            const inlineImgs = [];
                            g.areas.forEach(pt => {
                              const pageNum = pt.page || 1;
                              areas.filter(x => x.type === 'image' && (x.page || 1) === pageNum).forEach(img => {
                                const cx = img.rect.x + img.rect.w / 2;
                                const cy = img.rect.y + img.rect.h / 2;
                                if (cx >= pt.rect.x && cx <= pt.rect.x + pt.rect.w && cy >= pt.rect.y && cy <= pt.rect.y + pt.rect.h) {
                                  inlineImgs.push({ img, pageNum });
                                }
                              });
                            });
                            if (inlineImgs.length === 0) return null;
                            return (
                              <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #CBD5E1' }}>
                                <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#B45309', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ background: '#FEF3C7', border: '1px solid #FDE68A', padding: '1px 8px', borderRadius: 999 }}>🟨 인라인 이미지 {inlineImgs.length}</span>
                                  <span style={{ color: '#94A3B8', fontWeight: 500 }}>Step 2 이미지 영역 좌표에서 자동 추출</span>
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                  {inlineImgs.map(({ img, pageNum }, idx) => {
                                    const pageData = uploadedFile?.pages?.[pageNum - 1];
                                    if (!pageData) return null;
                                    const pw = pageData.width || CANVAS_W;
                                    const ph = pageData.height || CANVAS_H;
                                    const targetW = 160; // 카드 폭에 맞춰 축소
                                    const scale = targetW / img.rect.w;
                                    const targetH = img.rect.h * scale;
                                    return (
                                      <div key={img.id} title={`${img.name} · ${Math.round(img.rect.w)} × ${Math.round(img.rect.h)}`}
                                        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        <div style={{
                                          width: targetW, height: targetH,
                                          border: '1.5px solid #F59E0B', borderRadius: 6, overflow: 'hidden', position: 'relative', background: 'white',
                                        }}>
                                          <img src={pageData.dataUrl} alt={img.name}
                                            style={{
                                              position: 'absolute',
                                              width: pw * scale,
                                              height: ph * scale,
                                              left: -img.rect.x * scale,
                                              top: -img.rect.y * scale,
                                              maxWidth: 'none',
                                            }} />
                                        </div>
                                        <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#78350F', fontWeight: 700, textAlign: 'center' }}>[img:{idx + 1}] {img.name}</div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* 문항 탭 — 추가된(영역으로 생성된) 문항만 노출. 추가는 Step 2 영역 편집에서 */}
            {questions.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {questions.map((q, idx) => {
                  const focused = q.id === effectiveActiveId;
                  const filled = q.content.trim().length > 0;
                  return (
                    <button key={q.id}
                      onClick={() => setActiveQId(q.id)}
                      title={`문항 ${idx + 1} 보기`}
                      style={{
                        flex: '1 1 0', minWidth: 120,
                        padding: '10px 12px', borderRadius: 10,
                        border: focused ? '2px solid #2A75F3' : '1px solid #CBD5E1',
                        background: focused ? '#EFF6FF' : 'white',
                        color: focused ? '#1D4ED8' : '#1E293B',
                        fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      }}>
                      <span>{filled ? '✅' : '📝'}</span>
                      <span>문항 {idx + 1}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {questions.length === 0 ? (
              <div style={{ padding: '16px', textAlign: 'center', color: '#B45309', fontSize: 'var(--neo-font-size-sm)', background: '#FEF3C7', borderRadius: '10px' }}>
                Step 2에서 「문제」 영역을 1개 이상 지정해야 문항이 표시됩니다.
              </div>
            ) : activeQ && (() => {
              const q = activeQ;
              const i = activeIdx;
              const area = areaById[q.id];
              const rect = area?.rect;
              const hasImage = !!(uploadedFile?.dataUrl && rect && rect.w > 0 && rect.h > 0);
              const hasContent = q.content.trim().length > 0;
              return (
              <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '16px 18px', marginBottom: '14px' }}>
                <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B', marginBottom: '10px' }}>문항 {i + 1}</div>

                {/* 문항 내용 에디터 — 인식된 내용 전체 표시·수정 */}
                <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569', display: 'block', marginBottom: '6px' }}>문항 내용 <span style={{ color: '#EF4444' }}>*</span> <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>(인식 결과 확인·수정)</span></label>
                <div style={{ border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px', background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 700, marginRight: 4 }}>✏️ 본문 편집기</span>
                    <span style={tbSep} />
                    <button type="button" title="굵게" style={{ ...tbBtn, fontWeight: 800 }}><b>B</b></button>
                    <button type="button" title="기울임" style={tbBtn}><i>I</i></button>
                    <button type="button" title="밑줄" style={tbBtn}><u>U</u></button>
                    <button type="button" title="취소선" style={tbBtn}><s>S</s></button>
                    <span style={tbSep} />
                    <button type="button" title="글머리표" style={tbBtn}>≔</button>
                    <button type="button" title="번호 매기기" style={tbBtn}>①</button>
                    <button type="button" title="인용" style={tbBtn}>❝</button>
                    <button type="button" title="형광펜" style={tbBtn}>🖍</button>
                    <span style={tbSep} />
                    {hasImage && (
                      <button onClick={() => openOriginalImage(q.id)}
                        title="인식된 원본 이미지를 별도 창으로 띄웁니다. (이동·크기조절 가능)"
                        style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #CBD5E1', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-xs)', cursor: 'pointer' }}>🖼 원본 보기</button>
                    )}
                    <button onClick={() => pasteOcrSample(q.id)}
                      title="이 문항의 원본 영역에 대해 AI OCR을 다시 실행해 본문을 새로 채웁니다. (현재 stub — 샘플 텍스트로 시뮬레이션)"
                      style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #2A75F3', background: '#EFF6FF', color: '#1D4ED8', fontWeight: 700, fontSize: 'var(--neo-font-size-xs)', cursor: 'pointer' }}>📋 OCR 다시 실행</button>
                    {/* [v2.15] AI 개선 버튼 — OCR 다시 실행 옆에 배치 */}
                    {(() => {
                      const hasContent = !!q.content.trim();
                      return (
                        <button
                          onClick={() => openAiImprove(q.id)}
                          disabled={!hasContent}
                          title={hasContent ? '입력한 문항 내용을 AI로 다듬은 결과를 미리보고 적용합니다.' : '문항 내용을 입력하면 AI 개선을 사용할 수 있습니다.'}
                          style={{ padding: '3px 10px', borderRadius: 6, border: `1px solid ${hasContent ? '#2A75F3' : '#E2E8F0'}`, background: hasContent ? '#EFF6FF' : '#F1F5F9', color: hasContent ? '#1D4ED8' : '#94A3B8', fontWeight: 700, fontSize: 'var(--neo-font-size-xs)', cursor: hasContent ? 'pointer' : 'not-allowed' }}
                        >✨ AI 개선</button>
                      );
                    })()}
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>{q.content.length}자</span>
                  </div>
                  <textarea
                    ref={(el) => { if (!el) return; el.style.height = 'auto'; el.style.height = Math.max(el.scrollHeight, 200) + 'px'; }}
                    onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.max(e.target.scrollHeight, 200) + 'px'; }}
                    value={q.content} placeholder={`영역 편집의 「문항 ${i + 1}」 영역에서 OCR이 인식한 내용이 표시됩니다. (자동 반영 — 잘못되면 직접 수정하거나 [📋 OCR 다시 실행])`} onChange={(e) => updateQuestion(q.id, { content: e.target.value })}
                    style={{ width: '100%', minHeight: 200, border: 'none', padding: '12px 14px', fontSize: 'var(--neo-font-size-base)', lineHeight: 1.7, resize: 'none', overflow: 'hidden', fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', display: 'block', color: '#1E2225' }} />
                </div>

                {/* 모범답안은 Step 4 「성취기준」에서 입력 (성취기준 매핑과 함께 처리) */}
              </div>
              );
            })()}
          </div>
          );
        })()}

        {/* Step 4 — 성취기준 (핵심역량 + 핵심평가영역 + 문항별 성취기준 1개) */}
        {step === 4 && (() => {
          const toggleInArray = (key, value) => {
            const arr = basicInfo[key];
            const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
            setBasicInfo({ ...basicInfo, [key]: next });
          };
          // [v2.7] 핵심평가영역이 문항별 독립이므로 활성 문항 기준으로 판단
          const activeQ = questions.find((qq) => qq.id === activeQId) ?? questions[0];
          const activeEvalAreas = activeQ ? activeQ.evaluationAreas : [];
          const evalAreasSelected = activeEvalAreas.length > 0;
          // 활성 문항의 영역 토글 (basicInfo 대신 — 문항별 독립)
          // [v2.39] 영역 해제 시 — 그 영역에 속한 선택된 standards도 자동 해제
          const toggleActiveQEvalArea = (area) => {
            if (!activeQ) return;
            setQuestions((qs) => qs.map((q) => {
              if (q.id !== activeQ.id) return q;
              const has = q.evaluationAreas.includes(area);
              const nextAreas = has ? q.evaluationAreas.filter((a) => a !== area) : [...q.evaluationAreas, area];
              if (has) {
                // 영역 해제 시 — 그 영역에 속한 선택된 standards를 필터링하여 자동 해제
                const curStandards = q.standards || (q.standard ? [q.standard] : []);
                const validStandards = curStandards.filter((sid) => {
                  const std = MOCK_STANDARDS.find((s) => s.id === sid);
                  return std && nextAreas.includes(std.area);
                });
                return {
                  ...q,
                  evaluationAreas: nextAreas,
                  standards: validStandards,
                  standard: validStandards[0] || '',
                };
              }
              return { ...q, evaluationAreas: nextAreas };
            }));
            // [v2.8] 핵심평가영역 칩 변경 시 성취기준 라디오 자동 펼침
            setStdOpen((p) => ({ ...p, [activeQ.id]: true }));
          };
          return (
            <div style={{ maxWidth: '880px', margin: '0 auto' }}>
              <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, marginBottom: '16px' }}>✅ Step 4. 성취기준</h2>

              {/* [v3.51] 문항 탭을 맨 위로 — 어느 문항 작업할지 먼저 선택 */}
              {questions.length > 0 && (() => {
                const effId0 = (questions.find((qq) => qq.id === activeQId)?.id) ?? questions[0]?.id;
                return (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                    {questions.map((qq, idx) => {
                      const isActive = qq.id === effId0;
                      const filled = !!qq.standard && isModelAnswerFilled(qq);
                      return (
                        <button key={qq.id} onClick={() => setActiveQId(qq.id)} title={`문항 ${idx + 1} 보기`}
                          style={{ flex: '1 1 0', minWidth: 130, padding: '10px 12px', borderRadius: 10,
                            border: isActive ? '2px solid #2A75F3' : '1px solid #CBD5E1',
                            background: isActive ? '#EFF6FF' : 'white',
                            color: isActive ? '#1D4ED8' : '#1E293B',
                            fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <span>{filled ? '✅' : '🎯'}</span>
                          <span>문항 {idx + 1}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

              {/* [v2.6] 레이아웃 재구성:
                  1) 활성 문항 미리보기 박스 (문항 N + 내용)
                  2) 「성취기준 매핑」 카드 — 핵심평가영역 + 성취기준 통합
                  3) 모범답안 카드 (별도) */}

              {/* (1) 활성 문항 미리보기 박스 — 어느 문항 작업 중인지 명시 */}
              {questions.length === 0 ? (
                <div style={{ padding: '14px', textAlign: 'center', color: '#B45309', fontSize: 'var(--neo-font-size-sm)', background: '#FEF3C7', borderRadius: '8px' }}>
                  Step 2에서 「문항」 영역을 1개 이상 지정해야 문항별 모범답안을 입력할 수 있습니다.
                </div>
              ) : (() => {
                const effId = (questions.find((qq) => qq.id === activeQId)?.id) ?? questions[0]?.id;
                const actIdx = questions.findIndex((qq) => qq.id === effId);
                const aq = questions[actIdx];
                if (!aq) return null;
                return (
                  <div style={{ padding: '12px 14px', background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 10, marginBottom: 14 }}>
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#1E293B', marginBottom: 4 }}>📝 문항 {actIdx + 1}</div>
                    <div title={aq.content || ''} style={{ fontSize: 'var(--neo-font-size-sm)', color: aq.content ? '#475569' : '#94A3B8', lineHeight: 1.55, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {aq.content ? (aq.content.split('\n')[0] || aq.content) : '(문항 내용 미입력 — Step 3에서 입력)'}
                    </div>
                  </div>
                );
              })()}

              {/* (2) 성취기준 매핑 카드 — 핵심평가영역 + 성취기준 통합 (v2.6) */}
              {questions.length > 0 && (() => {
                const effId = (questions.find((qq) => qq.id === activeQId)?.id) ?? questions[0]?.id;
                const actIdx = questions.findIndex((qq) => qq.id === effId);
                const q = questions[actIdx];
                if (!q) return null;
                return (
                  <div style={{
                    background: 'white',
                    border: evalAreasSelected ? '2px solid #10B981' : '2px solid #EF4444',
                    borderRadius: '12px',
                    padding: '20px',
                    display: 'flex', flexDirection: 'column', gap: '14px',
                    marginBottom: '16px',
                  }}>
                    {/* [v2.62] 핵심평가영역 섹션 안내 — 학교급/학년/교과/과목 4개 요소 표시 */}
                    <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>
                      학교급 : <strong style={{ color: '#1D4ED8' }}>{basicInfo.schoolLevel}</strong> / 학년 : <strong style={{ color: '#1D4ED8' }}>{basicInfo.grade}</strong> / 교과 : <strong style={{ color: '#1D4ED8' }}>{basicInfo.subject}</strong> / 과목 : <strong style={{ color: '#1D4ED8' }}>{basicInfo.subSubject}</strong>
                    </div>
                    <div>
                      <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>핵심평가영역 <span className="required" style={{ color: '#EF4444' }}>*</span> <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>(이 문항에 적용 · 1개 이상 · 다중)</span></div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {evalAreasOf(basicInfo.subject).length === 0 ? (
                          <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>선택한 교과에 정의된 핵심평가영역이 없습니다.</span>
                        ) : evalAreasOf(basicInfo.subject).map(a => {
                          const on = q.evaluationAreas.includes(a);
                          return (
                            <button key={a} onClick={() => toggleActiveQEvalArea(a)} style={{
                              padding: '6px 12px', borderRadius: '16px',
                              border: '1.5px solid', borderColor: on ? '#10B981' : '#E2E8F0',
                              background: on ? '#D1FAE5' : 'white', color: on ? '#047857' : '#475569',
                              fontSize: 'var(--neo-font-size-sm)', fontWeight: on ? 800 : 600, cursor: 'pointer',
                            }}>{on ? '✓ ' : ''}{a}</button>
                          );
                        })}
                      </div>
                    </div>

                    {/* 구분선 */}
                    <div style={{ height: 1, background: '#E2E8F0', margin: '4px 0' }} />

                    {/* 성취기준 섹션 — v2.34 다중 선택 가능 (1개 권장) */}
                    <div>
                      <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569', marginBottom: 6 }}>성취기준 <span style={{ color: '#EF4444' }}>*</span> <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>(이 문항에 적용 · 다중 선택 가능, 1개 권장)</span></div>
                      {/* [v2.61] 통합 배너 — 활용(좌) + 주의(우). warnExpanded에 따라 4:1 ↔ 1:4 비율 전환 */}
                      <div style={{ display: 'flex', gap: 0, marginBottom: 8, border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                        {/* 좌측: 성취기준의 활용 */}
                        <div onClick={() => warnExpanded && setWarnExpanded(false)}
                          style={{ flex: warnExpanded ? 1 : 4, background: '#EFF6FF', padding: '8px 12px', fontSize: 'var(--neo-font-size-xs)', color: '#1E40AF', cursor: warnExpanded ? 'pointer' : 'default', transition: 'flex 0.25s' }}>
                          <div style={{ fontWeight: 800, marginBottom: warnExpanded ? 0 : 4, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                            <span>{warnExpanded ? '▶' : '▼'}</span>
                            <span>ℹ️ {warnExpanded ? '활용' : '성취기준의 활용'}</span>
                          </div>
                          {!warnExpanded && (
                            <div style={{ lineHeight: 1.6 }}>
                              <div>• <strong>자동평가</strong>: 성취기준이 <strong>채점 기준</strong>으로 그대로 사용됩니다.</div>
                              <div>• <strong>자율평가</strong>: <strong>AI 채점 기준 생성</strong> 시 평가 내용의 참고 자료로 활용됩니다.</div>
                            </div>
                          )}
                        </div>
                        {/* 우측: 성취기준 2개 선택 주의 */}
                        <div onClick={() => !warnExpanded && setWarnExpanded(true)}
                          style={{ flex: warnExpanded ? 4 : 1, background: '#FFFBEB', padding: '8px 12px', fontSize: 'var(--neo-font-size-xs)', color: '#B45309', cursor: warnExpanded ? 'default' : 'pointer', transition: 'flex 0.25s', borderLeft: '1px solid #E2E8F0' }}>
                          <div style={{ fontWeight: 800, marginBottom: warnExpanded ? 8 : 0, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                            <span>{warnExpanded ? '▼' : '◀'}</span>
                            <span>⚠️ {warnExpanded ? '성취기준 2개 이상 선택 — 확인이 필요합니다' : '주의'}</span>
                          </div>
                          {warnExpanded && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                              {[
                                { icon: '✨', title: '1개 권장', desc: '자동평가는 성취기준 1개가 적절' },
                                { icon: '🎯', title: '모두 반영', desc: '선택한 성취기준이 채점 기준으로 사용' },
                                { icon: '⚠️', title: 'AI 응답 영향', desc: '평가내용이 많으면 응답 느려지거나 실패' },
                              ].map((item, i) => (
                                <div key={i} style={{ background: 'white', border: '1px solid #FDE68A', borderRadius: 6, padding: '8px 6px', textAlign: 'center' }}>
                                  <div style={{ fontSize: 'var(--neo-font-size-xl)', lineHeight: 1, marginBottom: 4 }}>{item.icon}</div>
                                  <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, color: '#B45309', marginBottom: 3 }}>{item.title}</div>
                                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#92400E', lineHeight: 1.4 }}>{item.desc}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      {q.evaluationAreas.length === 0 ? (
                        <div style={{ padding: '14px', textAlign: 'center', color: '#B45309', fontSize: 'var(--neo-font-size-sm)', background: '#FEF3C7', borderRadius: '8px' }}>
                          위 핵심평가영역을 먼저 선택하면 해당 성취기준이 표시됩니다.
                        </div>
                      ) : filteredStandardsFor(q.evaluationAreas).length === 0 ? (
                        <div style={{ padding: '14px', textAlign: 'center', color: '#94A3B8', fontSize: 'var(--neo-font-size-sm)', background: '#F8FAFC', borderRadius: '8px' }}>
                          선택한 핵심평가영역{basicInfo.competencies.length > 0 ? ' · 핵심역량' : ''} 조건에 해당하는 성취기준이 없습니다.
                        </div>
                      ) : (() => {
                        // [v2.34] 다중 선택 정책 — 체크박스 + 다중 선택 시 경고 박스
                        const selectedStandards = q.standards || (q.standard ? [q.standard] : []);
                        const multiWarn = selectedStandards.length >= 2;
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {/* [v2.61] 기존 인라인 「주의」 박스 폐기 — 통합 배너로 일원화 */}
                            {filteredStandardsFor(q.evaluationAreas).map((s) => {
                              const on = selectedStandards.includes(s.id);
                              return (
                                <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? '#2A75F3' : '#E2E8F0'}`, background: on ? '#EFF6FF' : 'white' }}>
                                  <input type="checkbox" checked={on} onChange={() => selectQuestionStandard(q.id, s.id)} style={{ marginTop: 2 }} />
                                  <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#334155', lineHeight: 1.5 }}>
                                    <span style={{ fontWeight: 700, color: '#047857' }}>[{s.area}]</span> {s.text}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}

              {/* (3) 모범답안 카드 — 별도 (v2.6) */}
              {questions.length > 0 && (() => {
                const effId = (questions.find((qq) => qq.id === activeQId)?.id) ?? questions[0]?.id;
                const actIdx = questions.findIndex((qq) => qq.id === effId);
                const aq = questions[actIdx];
                return (
                <>
                  {/* 모범답안 카드 — 활성 문항에만 적용 */}
                  {aq && (() => {
                    const q = aq;
                    const i = actIdx;
                    return (
                      <div key={q.id} style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '18px 20px', marginBottom: 16 }}>

                        {/* [v2.71] 모범답안 — contenteditable HTML (텍스트+이미지 inline) + 10MB 합계 가드 */}
                        {(() => {
                          const maOpen = modelAnsOpen[q.id] ?? true;
                          const ma = getModelAnswer(q);
                          const maFilled = isModelAnswerFilled(q);
                          const hasContent = q.content.trim().length > 0;
                          return (
                            <div style={{ marginTop: 12, border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' }}>
                              <button onClick={() => toggleModelAns(q.id)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 12px', background: maOpen ? '#F8FAFC' : 'white', border: 'none', borderBottom: maOpen ? '1px solid #E2E8F0' : 'none', cursor: 'pointer', textAlign: 'left' }}>
                                <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>{maOpen ? '▼' : '▶'}</span>
                                <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>모범답안 <span style={{ color: '#EF4444' }}>*</span> <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>(텍스트 · 이미지 · 수식 입력 가능)</span></span>
                                {!maFilled && <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#DC2626', fontWeight: 700 }}>미입력</span>}
                                {maFilled && <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#10B981', fontWeight: 700 }}>입력 완료</span>}
                              </button>
                              {maOpen && (() => {
                                const showOverlay = !maFilled && !modelAnsFocused;
                                return (
                                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                  {/* [v2.72] 헤더 — 자동 생성 + 전체 비우기. 합계 표시 제거 (10MB 가드는 유지) */}
                                  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                    {maFilled && (
                                      <button onClick={() => clearModelAnswer(q.id)} title="텍스트·이미지 전체 비우기"
                                        style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #E2E8F0', background: 'white', color: '#94A3B8', fontWeight: 700, fontSize: 'var(--neo-font-size-xs)', cursor: 'pointer' }}>전체 비우기</button>
                                    )}
                                    <button onClick={() => generateModelAnswers(q.id)} disabled={!hasContent}
                                      title={hasContent ? '문항 내용·성취기준을 기반으로 모범답안 텍스트를 생성합니다.' : '문항 내용을 먼저 입력하세요(Step 3).'}
                                      style={{ padding: '6px 12px', borderRadius: 8, border: `1px solid ${hasContent ? '#2A75F3' : '#E2E8F0'}`, background: hasContent ? '#EFF6FF' : '#F1F5F9', color: hasContent ? '#1D4ED8' : '#94A3B8', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: hasContent ? 'pointer' : 'not-allowed' }}>🤖 자동 생성</button>
                                  </div>
                                  <div style={{ position: 'relative' }}>
                                    {/* contenteditable 에디터 — ref callback으로 외부 변경만 반영, 사용자 입력 cursor 보존 */}
                                    <div
                                      ref={(el) => { if (el && el.innerHTML !== (ma.html || '')) el.innerHTML = ma.html || ''; }}
                                      data-model-answer-editor={q.id}
                                      contentEditable
                                      suppressContentEditableWarning
                                      onInput={(e) => updateModelAnswerHtml(q.id, e.currentTarget.innerHTML)}
                                      onPaste={(e) => handleModelAnswerPaste(e, q.id)}
                                      onFocus={() => setModelAnsFocused(true)}
                                      onBlur={() => setModelAnsFocused(false)}
                                      style={{ width: '100%', minHeight: 160, border: '1px solid #CBD5E1', borderRadius: 8, padding: '12px 14px', paddingRight: 80, fontSize: 'var(--neo-font-size-sm)', lineHeight: 1.6, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none', overflowY: 'auto', maxHeight: 480 }}
                                    />
                                    {/* 빈 상태 오버레이 — pointer-events:none으로 에디터 클릭 통과 */}
                                    {showOverlay && (
                                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
                                        <label style={{ pointerEvents: 'auto', padding: '10px 16px', borderRadius: 10, border: '1px dashed #94A3B8', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                                          onMouseDown={(e) => e.preventDefault()}>
                                          📷 이미지 업로드
                                          <input type="file" accept="image/*" multiple onChange={(e) => { onModelAnswerFiles(q.id, e.target.files); e.target.value = ''; }} style={{ display: 'none' }} />
                                        </label>
                                        <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>또는 텍스트를 입력하거나 Ctrl+V로 이미지를 붙여넣으세요</span>
                                      </div>
                                    )}
                                    <button onClick={() => setFormulaModal({ target: 'modelAnswer', qid: q.id, level: 'single', initialContent: '' })}
                                      title="모범답안에 수식(LaTeX)을 삽입·편집합니다"
                                      style={{ position: 'absolute', right: 8, top: 8, padding: '3px 9px', border: '1px solid #BFDBFE', background: '#EFF6FF', color: '#1D4ED8', borderRadius: 4, fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.4 }}>∑ 수식</button>
                                  </div>
                                </div>
                                );
                              })()}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  })()}
                </>
                );
              })()}
            </div>
          );
        })()}

        {/* Step 5 — 평가 방식·채점 기준 (TSK-13 동일) */}
        {step === 5 && (() => {
          const card = { background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: '18px 20px', marginBottom: 16 };
          const label = { fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569', marginBottom: 6, display: 'block' };
          const input = { width: '100%', padding: '9px 12px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 'var(--neo-font-size-sm)', fontFamily: 'inherit', boxSizing: 'border-box' };
          const chip = (on, color = '#2A75F3') => ({ padding: '6px 14px', borderRadius: 999, fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer', border: `1px solid ${on ? color : '#E2E8F0'}`, background: on ? `${color}14` : 'white', color: on ? color : '#64748B' });
          return (
            <div style={{ maxWidth: 920, margin: '0 auto' }}>
              <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, marginBottom: 16 }}>⚖️ Step 5. 평가 방식 · 채점 기준</h2>

              {/* 평가 방식 토글 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 18 }}>
                {[
                  { id: 'auto', icon: '🤖', t: '자동평가', d: '문항별 성취기준 기반, 채점 단계(3/5)에 맞는 DB 평가지표로 채점' },
                  { id: 'self', icon: '✍️', t: '자율평가', d: '문항별 채점 기준을 직접/AI로 작성 (배점·단계·간격)' },
                ].map((m) => {
                  const on = evalMode === m.id;
                  return (
                    <button key={m.id} onClick={() => setEvalMode(m.id)} style={{ textAlign: 'left', padding: '14px 16px', borderRadius: 14, cursor: 'pointer', border: `2px solid ${on ? '#2A75F3' : '#E2E8F0'}`, background: on ? '#EFF6FF' : 'white' }}>
                      <div style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 900, color: on ? '#1D4ED8' : '#1E293B', marginBottom: 4 }}>{m.icon} {m.t}</div>
                      <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', lineHeight: 1.5 }}>{m.d}</div>
                    </button>
                  );
                })}
              </div>

              {questions.length === 0 && (
                <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '12px 16px', fontSize: 'var(--neo-font-size-sm)', color: '#B45309', fontWeight: 600 }}>
                  ⚠ Step 2에서 「문제」 영역을 지정해야 문항이 생성되어 평가를 설정할 수 있습니다.
                </div>
              )}

              {/* 자동평가 — 문항 탭 + 총 배점 요약 + 활성 문항 카드 */}
              {evalMode === 'auto' && questions.length > 0 && (() => {
                const effectiveActiveId = (questions.find((qq) => qq.id === activeQId)?.id) ?? questions[0]?.id;
                const activeIdx = questions.findIndex((qq) => qq.id === effectiveActiveId);
                const activeQ = questions[activeIdx];
                const totalAuto = questions.reduce((s, q) => s + (Number(q.points) || 0), 0);
                const levels = AUTO_LEVELS[autoScale];
                // [v2.47] 다중 standards 지원 — activeRubricStdMap에서 sid 추출, 기본 standards[0]
                const activeStandards = activeQ ? (activeQ.standards && activeQ.standards.length > 0 ? activeQ.standards : (activeQ.standard ? [activeQ.standard] : [])) : [];
                const currentRubricSid = activeQ ? (activeRubricStdMap[activeQ.id] && activeStandards.includes(activeRubricStdMap[activeQ.id]) ? activeRubricStdMap[activeQ.id] : activeStandards[0]) : null;
                const std = currentRubricSid ? MOCK_STANDARDS.find((s) => s.id === currentRubricSid) : null;
                return (
                <div>
                  {/* [v3.49] 자동평가 채점 등급 (3/5등급) */}
                  <div style={{ ...card, background: '#F8FAFC' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#1E293B' }}>채점 등급</span>
                      {AUTO_SCALES.map((n) => (
                        <button key={n} onClick={() => setAutoScale(n)} style={chip(autoScale === n)}>{autoScale === n ? '✓ ' : ''}{n}등급</button>
                      ))}
                      {/* [v2.53] 자명한 안내문 제거 */}
                    </div>
                  </div>

                  {/* 문항 탭 — 추가된 문항만 노출 */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    {questions.map((q, idx) => {
                      const focused = q.id === effectiveActiveId;
                      const pts = Number(q.points) || 0;
                      return (
                        <button key={q.id} onClick={() => setActiveQId(q.id)} title={`문항 ${idx + 1} 보기`}
                          style={{ flex: '1 1 0', minWidth: 130, padding: '10px 12px', borderRadius: 10,
                            border: focused ? '2px solid #2A75F3' : '1px solid #CBD5E1',
                            background: focused ? '#EFF6FF' : 'white',
                            color: focused ? '#1D4ED8' : '#1E293B',
                            fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <span>📝</span>
                          <span>문항 {idx + 1}</span>
                          <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#1D4ED8', background: '#DBEAFE', padding: '2px 7px', borderRadius: 999 }}>{pts}점</span>
                        </button>
                      );
                    })}
                  </div>


                  {/* 활성 문항 카드 */}
                  {activeQ && (
                    <div key={activeQ.id} style={card}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>{activeQ.label}</span>
                        {/* [v2.52] 다중 성취기준 시 코드 버튼 — 활성 sid는 강조. 클릭 시 셀렉트박스와 동시 갱신 */}
                        {activeStandards.length === 0 ? (
                          <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#B45309' }}>Step 3에서 성취기준을 선택해 주세요.</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {activeStandards.map((sid) => {
                              const s = MOCK_STANDARDS.find((x) => x.id === sid);
                              if (!s) return null;
                              const isActive = sid === currentRubricSid;
                              return (
                                <button key={sid} onClick={() => setActiveRubricStdMap((p) => ({ ...p, [activeQ.id]: sid }))}
                                  title={s.text}
                                  style={{
                                    padding: '3px 10px', borderRadius: 999, fontSize: 'var(--neo-font-size-xs)', fontWeight: 800,
                                    border: isActive ? '1px solid #047857' : '1px solid #E2E8F0',
                                    background: isActive ? '#D1FAE5' : 'white',
                                    color: isActive ? '#047857' : '#64748B',
                                    cursor: 'pointer',
                                  }}>
                                  [{stdCode(s.text)}]
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 700 }}>배점</span>
                          <input type="number" min={0} style={{ ...input, width: 90 }} value={activeQ.points} placeholder="배점" onChange={(e) => updateQuestion(activeQ.id, { points: e.target.value })} />
                          <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>점</span>
                        </div>
                      </div>
                      {std && (
                        <div>
                          {/* [v2.51] 1행: 성취기준 셀렉트 + 원본 템플릿 복원 버튼 */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                            {activeStandards.length >= 2 && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 240 }}>
                                <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 700, flexShrink: 0 }}>성취기준</span>
                                <select value={currentRubricSid || ''} onChange={(e) => setActiveRubricStdMap((p) => ({ ...p, [activeQ.id]: e.target.value }))}
                                  style={{ ...input, padding: '6px 8px', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1D4ED8', flex: 1, minWidth: 0 }}>
                                  {activeStandards.map((sid) => {
                                    const s = MOCK_STANDARDS.find((x) => x.id === sid);
                                    if (!s) return null;
                                    return <option key={sid} value={sid}>{s.text}</option>;
                                  })}
                                </select>
                              </div>
                            )}
                            <button onClick={() => regenerateRubric(activeQ.id, currentRubricSid, autoScale)}
                              title="수정한 셀을 원본 템플릿(DB의 2022 개정 교육과정 내용체계)으로 되돌립니다. 빈 칸만 채워지며, 수정한 칸은 ✕로 비운 뒤 호출하세요."
                              style={{ marginLeft: activeStandards.length >= 2 ? 0 : 'auto', padding: '6px 12px', borderRadius: 8, border: '1px solid #2A75F3', background: '#EFF6FF', color: '#1D4ED8', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>↺ 원본 템플릿 복원</button>
                          </div>
                          {/* [v2.54] 2행: 안내 텍스트 단독 — 박스 보더·배경 제거, 텍스트만 */}
                          <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', padding: '4px 0 8px', marginBottom: 10 }}>
                            📌 2022 개정 교육과정을 기준으로 한 평가지표입니다. 필요에 따라 수정하세요.
                          </div>
                          <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: 10 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--neo-font-size-sm)', minWidth: 200 + levels.length * 180 }}>
                              <thead>
                                <tr style={{ borderBottom: '2px solid #E2E8F0' }}>
                                  <th style={{ textAlign: 'left', padding: '10px 12px', color: '#475569', fontWeight: 800, width: 180, background: '#F8FAFC' }}>범주</th>
                                  {levels.map((lv) => {
                                    const meta = LEVEL_META[lv.name] || { color: '#475569' };
                                    return <th key={lv.letter} style={{ textAlign: 'left', padding: '10px 12px', fontWeight: 800, color: meta.color, background: '#F8FAFC' }}>{lv.name} ({lv.letter})</th>;
                                  })}
                                </tr>
                              </thead>
                              <tbody>
                                {RUBRIC_CATEGORIES.map((cat) => (
                                  <tr key={cat.key} style={{ borderTop: '1px solid #F1F5F9', verticalAlign: 'top' }}>
                                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1E293B' }}>{cat.key}. {cat.name}</td>
                                    {levels.map((lv, lvIdx) => {
                                      const cellVal = rubricCell(activeQ.id, currentRubricSid, cat.key, lvIdx, autoScale);
                                      const hasVal = !!(cellVal && cellVal.trim());
                                      return (
                                      <td key={lv.letter} style={{ padding: '6px 8px' }}>
                                        <div style={{ position: 'relative' }}>
                                          <textarea value={cellVal} onChange={(e) => setRubricCell(activeQ.id, currentRubricSid, cat.key, lvIdx, e.target.value)}
                                            style={{ width: '100%', minHeight: 72, border: '1px solid #E2E8F0', borderRadius: 6, padding: '6px 8px', paddingRight: hasVal ? 24 : 8, fontSize: 'var(--neo-font-size-xs)', lineHeight: 1.5, color: '#334155', fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
                                          {hasVal && (
                                            <button onClick={() => clearRubricCell(activeQ.id, currentRubricSid, cat.key, lvIdx)}
                                              title="비우기 (재생성 시 템플릿으로 다시 채움)"
                                              style={{ position: 'absolute', right: 4, top: 4, width: 18, height: 18, borderRadius: '50%', border: 'none', background: '#E2E8F0', color: '#475569', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1, padding: 0 }}>✕</button>
                                          )}
                                        </div>
                                      </td>
                                      );
                                    })}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                );
              })()}

              {/* 자율평가 — 문항 탭 + 총 배점 요약 + 활성 문항 카드 */}
              {evalMode === 'self' && questions.length > 0 && (() => {
                const effectiveActiveId = (questions.find((qq) => qq.id === activeQId)?.id) ?? questions[0]?.id;
                const activeIdx = questions.findIndex((qq) => qq.id === effectiveActiveId);
                const activeQ = questions[activeIdx];
                const qTotal = (q) => q.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
                const totalSelf = questions.reduce((s, q) => s + qTotal(q), 0);
                const qStd = activeQ ? MOCK_STANDARDS.find((s) => s.id === activeQ.standard) : null;
                return (
                <div>
                  {/* [v3.49] 자율평가 채점 등급 — 자동평가와 명칭 통일. 합산 점수의 등급명만 결정 (채점기준 「배점 단계」와 별개) */}
                  <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 12, padding: '14px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#1E293B' }}>채점 등급</span>
                    {[3, 4, 5].map((n) => (
                      <button key={n} onClick={() => setSelfScale(n)}
                        style={{ padding: '7px 16px', borderRadius: 999, border: `1.5px solid ${selfScale === n ? '#2A75F3' : '#E2E8F0'}`, background: selfScale === n ? '#EFF6FF' : 'white', color: selfScale === n ? '#1D4ED8' : '#475569', fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, cursor: 'pointer' }}>
                        {selfScale === n ? '✓ ' : ''}{n}등급
                      </button>
                    ))}
                    <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', marginLeft: 'auto' }}>
                      {(() => {
                        // [v2.45] selfScale별 등급 라벨 동적 표시 — 3등급(우수~노력) / 4등급(매우우수~노력) / 5등급(매우우수~매우노력)
                        const names = GRADE_NAMES[selfScale] || [];
                        const range = names.length >= 2 ? `${names[0]}~${names[names.length - 1]}` : '';
                        return <>채점기준 점수의 <strong>합산 → {selfScale}등급({range})</strong>으로 환산.</>;
                      })()}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#1E40AF', background: '#EFF6FF', border: '1px solid #BFDBFE', padding: '10px 12px', borderRadius: 8, marginBottom: 14, lineHeight: 1.6 }}>
                    문항마다 채점 기준을 1~5개까지 만들 수 있습니다.
                  </div>

                  {/* 문항 탭 */}
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    {questions.map((q, idx) => {
                      const focused = q.id === effectiveActiveId;
                      const pts = qTotal(q);
                      return (
                        <button key={q.id} onClick={() => setActiveQId(q.id)} title={`문항 ${idx + 1} 보기`}
                          style={{ flex: '1 1 0', minWidth: 130, padding: '10px 12px', borderRadius: 10,
                            border: focused ? '2px solid #2A75F3' : '1px solid #CBD5E1',
                            background: focused ? '#EFF6FF' : 'white',
                            color: focused ? '#1D4ED8' : '#1E293B',
                            fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          <span>✍️</span>
                          <span>문항 {idx + 1}</span>
                          <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#1D4ED8', background: '#DBEAFE', padding: '2px 7px', borderRadius: 999 }}>{pts}점</span>
                        </button>
                      );
                    })}
                  </div>


                  {/* 활성 문항 카드 */}
                  {activeQ && (() => {
                    const q = activeQ;
                    return (
                    <div key={q.id} style={card}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, color: '#1E293B' }}>{q.label}</span>
                          {qStd ? (
                            <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#047857', background: '#D1FAE5', padding: '3px 9px', borderRadius: 999 }}>[{qStd.area}] {stdCode(qStd.text)}</span>
                          ) : (
                            <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#B45309' }}>Step 3에서 성취기준 선택</span>
                          )}
                        </div>
                        <button onClick={() => aiGenerateCriteria(q.id)} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #2A75F3', background: '#EFF6FF', color: '#1D4ED8', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>🤖 AI 채점 기준 생성</button>
                      </div>

                      {/* [v2.66] 총 배점 입력 행 — [↻ 균등 재분배] 버튼 폐기. 합 불일치 정합화는 상단 영구 경고 배너 [↻ 모두 균등 재분배] / 저장 정합성 모달로 일원화 */}
                      {(() => {
                        const total = Number(q.points) || 0;
                        const sum = q.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
                        const diff = sum - total;
                        const ok = total > 0 && diff === 0;
                        return (
                          <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569' }}>총 배점</span>
                            <input type="number" min={0} style={{ ...input, width: 90 }} value={q.points} placeholder="예: 100"
                              onChange={(e) => updateQuestionPoints(q.id, e.target.value)} />
                            <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>점</span>
                            {total > 0 ? (
                              <>
                                <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569' }}>
                                  · 채점기준 합계 <strong style={{ color: ok ? '#10B981' : '#B45309' }}>{sum}점</strong>
                                </span>
                                {!ok && (
                                  <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#B45309', fontWeight: 700 }}>
                                    ⚠ 총 배점 대비 {diff > 0 ? '+' : ''}{diff}점 차이
                                  </span>
                                )}
                              </>
                            ) : (
                              <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>· 입력 시 채점기준 추가/재분배 기준이 됩니다. 미입력 시 채점기준별 개별 배점.</span>
                            )}
                          </div>
                        );
                      })()}

                      {q.criteria.map((c, ci) => (
                        <div key={c.id} style={{ border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 14px', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                            <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#64748B', minWidth: 48 }}>채점 {ci + 1}</span>
                            <div style={{ flex: 1, position: 'relative' }}>
                              <input style={{ ...input, paddingRight: c.name && c.name.trim() ? 32 : 12 }} value={c.name} placeholder="채점 기준명 (예: 주제 명확성)" onChange={(e) => updateCriterion(q.id, c.id, { name: e.target.value })} />
                              {c.name && c.name.trim() && (
                                <button onClick={() => updateCriterion(q.id, c.id, { name: '' })}
                                  title="비우기 (재생성 시 AI가 다시 채움)"
                                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: 'none', background: '#E2E8F0', color: '#475569', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>✕</button>
                              )}
                            </div>
                            {q.criteria.length > 1 && <button onClick={() => removeCriterion(q.id, c.id)} title="이 채점 기준 카드 삭제" style={{ border: '1px solid #FECACA', background: 'white', color: '#EF4444', cursor: 'pointer', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, padding: '4px 10px', borderRadius: 8 }}>🗑 카드 삭제</button>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 4, flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 700 }}>배점</span>
                              <input type="number" min={2} style={{ ...input, width: 80 }} value={c.maxPoints} onChange={(e) => updateCriterion(q.id, c.id, { maxPoints: e.target.value })} />
                              <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B' }}>점</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 700 }}>배점 단계</span>
                              <div style={{ display: 'flex', alignItems: 'center', border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
                                <button onClick={() => changeCriterionLevels(q.id, c.id, -1)} disabled={c.levels <= 2} style={{ width: 30, height: 32, border: 'none', background: c.levels <= 2 ? '#F1F5F9' : 'white', color: c.levels <= 2 ? '#CBD5E1' : '#475569', fontSize: 'var(--neo-font-size-base)', fontWeight: 800, cursor: c.levels <= 2 ? 'not-allowed' : 'pointer' }}>−</button>
                                <span style={{ minWidth: 48, textAlign: 'center', fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#1E293B' }}>{c.levels}단계</span>
                                <button onClick={() => changeCriterionLevels(q.id, c.id, 1)} disabled={c.levels >= clampLevels(c.maxPoints)} style={{ width: 30, height: 32, border: 'none', background: c.levels >= clampLevels(c.maxPoints) ? '#F1F5F9' : 'white', color: c.levels >= clampLevels(c.maxPoints) ? '#CBD5E1' : '#475569', fontSize: 'var(--neo-font-size-base)', fontWeight: 800, cursor: c.levels >= clampLevels(c.maxPoints) ? 'not-allowed' : 'pointer' }}>+</button>
                              </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 700 }}>배점 간격</span>
                              <select style={{ ...input, width: 84 }} value={c.interval} onChange={(e) => updateCriterion(q.id, c.id, { interval: Number(e.target.value) })}>
                                {Array.from({ length: maxIntervalFor(c.maxPoints, c.levels) }, (_, k) => k + 1).map((v) => <option key={v} value={v}>{v}점</option>)}
                              </select>
                            </div>
                            <button onClick={() => redistribute(q.id, c.id)} title="배점부터 0점까지 간격만큼 균등하게 점수를 분배합니다." style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #CBD5E1', background: 'white', color: '#475569', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer' }}>↻ 점수 균등 분배</button>
                          </div>
                          <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600, marginBottom: 10 }}>간격으로 자동 분배된 점수를 기본으로 채워두며, 아래 표에서 각 단계 점수를 직접 수정할 수 있습니다. (0~배점, 정수)</div>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--neo-font-size-sm)' }}>
                            <thead>
                              <tr style={{ background: '#F8FAFC' }}>
                                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748B', fontWeight: 700, width: 96 }}>점수</th>
                                <th style={{ textAlign: 'left', padding: '6px 8px', color: '#64748B', fontWeight: 700 }}>평가 내용</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.rows.map((r, ri) => (
                                <tr key={ri} style={{ borderTop: '1px solid #F1F5F9' }}>
                                  <td style={{ padding: '4px 8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      {/* [v2.36] 동적 min/max 제거 — 브라우저가 큰 수 입력 자체를 차단하면 onChange가 발생 안 해 토스트가 안 뜸. 절대 상한(maxPoints)/0만 두고 단조 감소 검증은 onChange에서 처리 */}
                                      <input type="number" min={0} max={Number(c.maxPoints) || 0} value={r.score} onChange={(e) => updateRowScore(q.id, c.id, ri, e.target.value)}
                                        style={{ width: 56, padding: '6px 8px', border: '1px solid #CBD5E1', borderRadius: 6, fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#2A75F3', fontFamily: 'inherit', textAlign: 'center', boxSizing: 'border-box' }} />
                                      <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>점</span>
                                    </div>
                                  </td>
                                  <td style={{ padding: '4px 8px' }}>
                                    {/* [v2.17] 평가내용 — input처럼 보이는 에디터. [∑+ 수식]/chip 클릭 시 평가내용 전체를 편집기에 로드 */}
                                    <EvalContentEditor
                                      desc={r.desc}
                                      placeholder={`${r.score}점 수준의 평가 내용`}
                                      onChange={(v) => updateRowDesc(q.id, c.id, ri, v)}
                                      onOpenEditor={() => setFormulaModal({ qid: q.id, cid: c.id, ri, initialContent: r.desc || '' })}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {/* [v2.35] 단조 감소 경고 박스 폐기 — 입력 시점에 차단(updateRowScore + input dynMin/dynMax)으로 정책 강제 */}
                        </div>
                      ))}
                      <button onClick={() => addCriterion(q.id)} style={{ width: '100%', padding: '9px', borderRadius: 8, border: '1px dashed #94A3B8', background: 'white', color: '#475569', fontWeight: 700, cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)' }}>+ 채점 기준 추가 ({q.criteria.length}/5)</button>

                      {/* [v2.47] 등급 환산 미리보기 — 우측 fixed 패널 + 토글 (펼침/접힘) */}
                      {(() => {
                        const qMax = q.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
                        if (previewExpanded) {
                          return (
                            <div style={{ position: 'fixed', right: 16, top: 120, width: 320, background: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: 10, padding: '12px 14px', zIndex: 100, boxShadow: '0 4px 16px rgba(15,23,42,0.12)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#0C4A6E' }}>📊 등급 환산 미리보기</span>
                                <span style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#0369A1', background: 'white', padding: '2px 8px', borderRadius: 999, border: '1px solid #BAE6FD' }}>{selfScale}등급</span>
                                <button onClick={() => setPreviewExpanded(false)} title="접기" style={{ marginLeft: 'auto', padding: '3px 8px', borderRadius: 6, border: '1px solid #BAE6FD', background: 'white', color: '#0369A1', fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, cursor: 'pointer' }}>접기 ⮟</button>
                              </div>
                              {qMax <= 0 ? (
                                <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#92400E', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, padding: '8px 10px', lineHeight: 1.55 }}>
                                  채점기준에 배점이 입력되면 자동 표시됩니다.
                                </div>
                              ) : (
                                <>
                                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#475569', marginBottom: 8 }}>활성 문항 만점 <strong style={{ color: '#0369A1' }}>{qMax}점</strong></div>
                                  {/* [v2.48] 등급별 1행씩 세로 배치 — 좌측 등급명 + 우측 점수 범위 */}
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {GRADE_CUTOFFS[selfScale].map((b, bi, arr) => {
                                      const meta = LEVEL_META[b.name] || { color: '#475569', bg: '#F1F5F9' };
                                      const upper = bi === 0 ? 100 : arr[bi - 1].min;
                                      const minExact = (b.min / 100) * qMax;
                                      const maxExact = bi === 0 ? qMax : (upper / 100) * qMax;
                                      const lo = Math.ceil(minExact);
                                      const hi = bi === 0 ? qMax : (Number.isInteger(maxExact) ? maxExact - 1 : Math.floor(maxExact));
                                      const empty = lo > hi;
                                      const label = empty ? '(없음)' : lo === hi ? `${lo}점` : `${lo}~${hi}점`;
                                      return (
                                        <div key={b.name} style={{ background: empty ? '#F8FAFC' : meta.bg, border: `1px solid ${empty ? '#E2E8F0' : meta.bg}`, borderRadius: 6, padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                          <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: empty ? '#94A3B8' : meta.color }}>{b.name}</div>
                                          <div style={{ fontSize: 'var(--neo-font-size-xs)', color: empty ? '#94A3B8' : '#1E293B', fontWeight: 700, fontStyle: empty ? 'italic' : 'normal' }}>{label}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#0369A1', marginTop: 8, lineHeight: 1.5 }}>
                                    ※ 채점 결과는 위 등급으로 환산. 점수는 내부 산출용이며 사용자에게는 등급만 노출됩니다.
                                  </div>
                                </>
                              )}
                            </div>
                          );
                        }
                        // 접힘 상태 — 우측 화면 끝 작은 탭
                        return (
                          <div onClick={() => setPreviewExpanded(true)} title="펼치기"
                            style={{ position: 'fixed', right: 0, top: 140, background: '#0369A1', color: 'white', padding: '10px 8px', borderRadius: '8px 0 0 8px', cursor: 'pointer', zIndex: 100, fontSize: 'var(--neo-font-size-xs)', fontWeight: 800, boxShadow: '-2px 0 8px rgba(15,23,42,0.12)', writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: '0.05em' }}>
                            📊 등급 환산 미리보기 ⮜
                          </div>
                        );
                      })()}
                    </div>
                    );
                  })()}
                </div>
                );
              })()}
            </div>
          );
        })()}

        {/* Step 6 — 그룹 배포 · 문답지 출력 (별도 탭) */}
        {step === 6 && (() => {
          const printableCount = printableGroups.length;
          const codeBtn = (on) => ({ padding: '7px 14px', borderRadius: 8, fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer', border: on ? '1px solid #EF4444' : 'none', background: on ? 'white' : '#F59E0B', color: on ? '#EF4444' : 'white' });
          const studentBtn = (on) => ({ padding: '7px 14px', borderRadius: 8, fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer', border: on ? '1px solid #EF4444' : 'none', background: on ? 'white' : '#2A75F3', color: on ? '#EF4444' : 'white' });
          const badge = (bg, color) => ({ background: bg, color, fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, padding: '2px 8px', borderRadius: 10 });
          return (
            <div style={{ maxWidth: '920px', margin: '0 auto' }}>
              <h2 style={{ fontSize: 'var(--neo-font-size-lg)', fontWeight: 800, marginBottom: '8px' }}>🚀 Step 6. 그룹 배포 · 문답지 출력</h2>
              <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginBottom: '16px' }}>
                응시 설정 → 그룹 배포 → 문답지 출력 순으로 진행합니다.
                <strong> 번호표 배포</strong> = 과제 할당(채점 관리 미채점 진입, 학생 화면 미노출), <strong>학생 배포</strong> = 학생에게 노출(번호표도 함께 배포).
              </p>

              {/* [v2.32] 응시·출력 설정 카드 — 배포 전에 학생 응시 정책 + 답안지 출력 매수를 함께 결정 (v2.11 응시 설정 + v2.24 출력 매수 통합) */}
              <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '18px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <label style={{ margin: 0, fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', color: '#475569' }}>응시·출력 설정</label>
                  <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', fontWeight: 500 }}>— 배포 전에 응시 정책과 답안지 출력 매수를 결정합니다</span>
                </div>

                {/* 응시 정책 섹션 */}
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#94A3B8', marginBottom: 6, letterSpacing: '0.02em' }}>응시 정책</div>
                  <div style={{
                    background: blockCopyPaste ? '#FEF2F2' : '#F8FAFC',
                    border: `1px solid ${blockCopyPaste ? '#FCA5A5' : '#E5E7EB'}`,
                    borderRadius: 10,
                    padding: '14px 16px',
                    transition: 'all 0.2s ease',
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                      <span
                        role="switch"
                        aria-checked={blockCopyPaste}
                        onClick={() => setBlockCopyPaste(v => !v)}
                        style={{
                          position: 'relative', width: 44, height: 24, borderRadius: 12,
                          background: blockCopyPaste ? '#EF4444' : '#CBD5E1',
                          transition: 'background 0.2s ease', flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 2, left: blockCopyPaste ? 22 : 2,
                          width: 20, height: 20, borderRadius: '50%', background: 'white',
                          transition: 'left 0.2s ease', boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
                        }} />
                      </span>
                      <input type="checkbox" checked={blockCopyPaste} onChange={(e) => setBlockCopyPaste(e.target.checked)} style={{ display: 'none' }} />
                      <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 700, color: '#1E2225' }}>복사·붙여넣기 차단</span>
                      <span title="공정한 평가를 위해 학생이 AI 생성 답안 등 외부 출처 문구를 그대로 복제하지 못하도록 차단합니다. 학생 응시 화면에만 적용됩니다." style={{ fontSize: 'var(--neo-font-size-xs)', color: '#8A94A1', cursor: 'help', border: '1px solid #CBD5E1', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</span>
                    </label>
                    <p style={{
                      margin: '10px 0 0 56px', fontSize: 'var(--neo-font-size-sm)',
                      color: blockCopyPaste ? '#B91C1C' : '#475569',
                      fontWeight: 600, lineHeight: 1.5,
                    }}>
                      {blockCopyPaste
                        ? '🚫 학생은 답안 입력 시 복사·붙여넣기를 사용할 수 없습니다. (Ctrl+C/V, 우클릭 메뉴, 드래그 복사 모두 차단)'
                        : '✅ 학생은 답안 입력 시 복사·붙여넣기를 자유롭게 사용할 수 있습니다.'}
                    </p>
                  </div>
                </div>

                {/* [v2.57] 출력 정책 섹션 — 문항별 답안지 수 매핑 */}
                <div>
                  <div style={{ fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, color: '#94A3B8', marginBottom: 6, letterSpacing: '0.02em' }}>출력 정책</div>
                  <div style={{ background: '#F8FAFC', border: '1px solid #E5E7EB', borderRadius: 10, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 700, color: '#1E2225' }}>📝 문항당 인쇄할 답안지 수</span>
                      <span title="각 문항별로 인쇄할 답안지 매수입니다. 학생 1명당 합산 매수가 답안지 PDF 생성에 적용됩니다." style={{ fontSize: 'var(--neo-font-size-xs)', color: '#8A94A1', cursor: 'help', border: '1px solid #CBD5E1', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>ℹ</span>
                      <span style={{ marginLeft: 'auto', fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 700 }}>학생당 총 <strong style={{ color: '#1D4ED8' }}>{totalCopies}</strong>장</span>
                    </div>
                    {questions.length === 0 ? (
                      <p style={{ margin: 0, fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8', fontStyle: 'italic' }}>문항을 먼저 입력하세요.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {questions.map((q, idx) => {
                          const copies = getCopies(q.id);
                          return (
                            <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'white', border: '1px solid #E2E8F0', borderRadius: 8 }}>
                              <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1E293B', minWidth: 60 }}>문항 {idx + 1}</span>
                              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button onClick={() => setCopies(q.id, copies - 1)} disabled={copies <= 1}
                                  style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #CBD5E1', background: copies <= 1 ? '#F1F5F9' : 'white', color: copies <= 1 ? '#CBD5E1' : '#475569', cursor: copies <= 1 ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', padding: 0, lineHeight: 1 }}>−</button>
                                {/* [v2.58] 직접 입력 가능한 input — 1~10 자동 clamp */}
                                <input type="number" min={1} max={10} value={copies}
                                  onChange={(e) => { const n = parseInt(e.target.value, 10); if (Number.isFinite(n)) setCopies(q.id, n); }}
                                  style={{ width: 44, textAlign: 'center', fontWeight: 800, color: '#1E293B', fontSize: 'var(--neo-font-size-base)', border: '1px solid #CBD5E1', borderRadius: 6, padding: '3px 4px', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                                <button onClick={() => setCopies(q.id, copies + 1)} disabled={copies >= 10}
                                  style={{ width: 24, height: 24, borderRadius: '50%', border: '1px solid #CBD5E1', background: copies >= 10 ? '#F1F5F9' : 'white', color: copies >= 10 ? '#CBD5E1' : '#475569', cursor: copies >= 10 ? 'not-allowed' : 'pointer', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', padding: 0, lineHeight: 1 }}>+</button>
                                <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#475569', fontWeight: 700 }}>장</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <p style={{ margin: '8px 0 0 0', fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', fontWeight: 600 }}>(문항별 기본 1장 · 최대 10장)</p>
                  </div>
                </div>
              </div>

              <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '18px' }}>
                <div style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#475569', marginBottom: '10px' }}>배포 그룹</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {groupList.map((g) => (
                    <div key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 10 }}>
                      <span style={{ fontWeight: 700, color: '#1E293B', fontSize: 'var(--neo-font-size-base)' }}>{g.label}</span>
                      <span style={{ color: '#94A3B8', fontSize: 'var(--neo-font-size-sm)' }}>{g.studentCount}명</span>
                      {g.codeDeployed && !g.studentDeployed && <span style={badge('#FEF3C7', '#B45309')}>📋 번호표 배포</span>}
                      {g.studentDeployed && <span style={badge('#DBEAFE', '#1D4ED8')}>🚀 학생 배포</span>}
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                        {/* [v2.13] 학생 배포 상태일 때 번호표 버튼 숨김 — 학생 배포가 번호표 배포를 포함하므로 학생 배포 먼저 취소해야 번호표 취소 가능 */}
                        {!g.studentDeployed && (
                          <button onClick={() => toggleGroupCode(g.id)} title={g.codeDeployed ? '과제 할당을 해제합니다 (채점 관리 미채점에서 제거).' : 'ncode를 할당해 번호표를 인쇄할 수 있게 합니다. 학생 화면에는 아직 노출되지 않습니다.'} style={codeBtn(g.codeDeployed)}>{g.codeDeployed ? '↩ 번호표 배포 취소' : '📋 번호표 배포'}</button>
                        )}
                        <button onClick={() => toggleGroupStudent(g.id)} title={g.studentDeployed ? '학생 화면에서 과제를 숨깁니다.' : '학생에게 과제를 노출합니다(번호표 미배포 시 함께 배포).'} style={studentBtn(g.studentDeployed)}>{g.studentDeployed ? '↩ 학생 배포 취소' : '🚀 학생 배포'}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 문답지 출력 [v2.12] 그룹 배포 무관 항상 활성. 「번호표 배포 필요」 차단 안내 폐기 */}
              <div style={{ borderTop: '2px dashed #E2E8F0', marginTop: '24px', paddingTop: '20px' }}>
                <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, marginBottom: '6px' }}>🖨️ 문답지 출력</h3>
                <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', marginBottom: '14px' }}>
                  스마트펜 번호표·문제지·답안지를 출력합니다. 문제지·답안지에는 업로드한 파일과 영역 정보가 반영됩니다.
                </p>
                {/* [v2.24] 답안지 카드만 학생당 N장 spinner 인라인 — 3 카드 모두 div + [PDF 출력] 버튼 분리로 일관성 유지 */}
                <div style={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: '12px', padding: '18px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  {[
                    { icon: '✎', label: '스마트펜 번호표', desc: '3페이지로 제한(최대 117명)까지 인쇄 가능', key: 'tag' },
                    { icon: '📄', label: '문제지 출력', desc: '업로드 문제지 출력', key: 'question' },
                    { icon: '📝', label: '답안지 출력', desc: '스마트펜 인식용 답안지', key: 'answer' },
                  ].map((btn) => (
                    <div key={btn.label}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', padding: '18px 10px', borderRadius: '12px', border: '1px solid #CBD5E1', background: 'white', color: '#1E293B' }}>
                      <span style={{ fontSize: '1.8rem' }}>{btn.icon}</span>
                      <span style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800 }}>{btn.label}</span>
                      <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', textAlign: 'center' }}>{btn.desc}</span>
                      {/* [v2.33] 답안지 카드 「학생당 N장 인쇄」 안내 제거 — 매수는 응시·출력 설정 카드에서 결정·표시 (중복 노출 방지)
                          [TSK-05 v2.30] answer 카드는 미리보기 모달로 이관
                          [TSK-05 v3.4] tag 카드도 미리보기 모달로 이관, question은 기존 toast 유지 */}
                      <button onClick={() => {
                        if (btn.key === 'answer') {
                          setWorksheetPreviewOpen(true);
                        } else if (btn.key === 'tag') {
                          setNumberTagPreviewOpen(true);
                        } else if (showToast) {
                          showToast(`${btn.label} PDF 생성 중... (샘플)`);
                        }
                      }}
                        style={{ marginTop: 8, padding: '6px 18px', borderRadius: 8, border: 'none', background: '#2A75F3', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer', fontFamily: 'inherit' }}>
                        {(btn.key === 'answer' || btn.key === 'tag') ? '👁 미리보기' : '📥 PDF 출력'}
                      </button>
                    </div>
                  ))}
                </div>
                {/* [v2.14] 「번호표 배포된 그룹」 칩 영역 폐기 — 출력 카드만 노출 */}
              </div>
            </div>
          );
        })()}

        {/* [v3.49] 등급 환산 미리보기 모달 폐기 — 활성 문항 카드 하단 인라인 박스로 일원화 */}

      </div>

      {/* 하단 navigation — sticky bottom
          [v2.13] [✕ 취소] 폐기 → 헤더 [나가기]로 일원화.
          [← 이전 단계] · [다음 단계 →] 가운데 정렬. 안내 문구는 버튼 위쪽 1줄. */}
      <div style={{
        position: 'sticky', bottom: 0, zIndex: 10,
        background: 'white', borderTop: '1px solid #E2E8F0',
        padding: '12px 1.5rem', display: 'flex', flexDirection: 'column',
        boxShadow: '0 -4px 12px rgba(15,23,42,0.06)',
        alignItems: 'center', gap: '8px',
      }}>
        {/* 비활성화 시 사유 안내 — 사용자에게 어떤 조건을 충족해야 하는지 명확화 (버튼 위쪽 1줄) */}
        {step < 6 && !canNext() && (
          <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#DC2626', fontWeight: 700, textAlign: 'center' }}>
            {step === 1 && '⚠ 과제명 입력과 파일 업로드를 모두 완료해 주세요'}
            {step === 2 && (() => {
              const qSlots = computeAreaGroups(areas.filter(a => a.type === 'question')).length;
              const pSlots = computeAreaGroups(areas.filter(a => a.type === 'passage')).length;
              if (qSlots === 0) return '⚠ 문항 영역을 1개 이상 그려야 다음 단계로 진행할 수 있습니다';
              if (qSlots > 3) return `⚠ 문항이 ${qSlots}개입니다. 최대 3개 — [🔗 합치기]로 묶거나 일부 삭제하세요`;
              if (pSlots > 1) return `⚠ 지문이 ${pSlots}개입니다. 1개여야 합니다 — [🔗 합치기]로 묶거나 일부 삭제하세요`;
              return '⚠ 문항 영역을 1개 이상 그려야 다음 단계로 진행할 수 있습니다';
            })()}
            {step === 3 && '⚠ 모든 문항의 내용을 입력해야 합니다'}
            {step === 4 && '⚠ 각 문항마다 핵심평가영역(1개 이상)·성취기준(각 1개)·모범답안(상·중·하)을 입력해야 합니다'}
            {step === 5 && (evalMode === 'auto' ? '⚠ 문항별 배점을 입력해야 합니다' : (() => {
              const mismatch = questions.find((q) => {
                const total = Number(q.points) || 0;
                if (!total) return false;
                const sum = q.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
                return sum !== total;
              });
              if (mismatch) {
                const total = Number(mismatch.points) || 0;
                const sum = mismatch.criteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0);
                return `⚠ 문항 ${questions.indexOf(mismatch) + 1} — 채점기준 합 ${sum}점 ≠ 총 배점 ${total}점. [↻ 균등 재분배] 또는 직접 수정 후 진행하세요.`;
              }
              return '⚠ 채점 기준의 이름·배점과 각 단계 점수(내림차순)를 입력해야 합니다';
            })())}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={() => {
              if (step > 1) {
                // [v2.12] 단계 이동 시 자동 저장 — prototype 시뮬레이션 (토스트)
                showToast && showToast('저장됨');
                setStep(step - 1);
              }
            }}
            disabled={step === 1}
            style={{
              padding: '10px 22px', borderRadius: '10px', border: '1px solid #E2E8F0',
              background: 'white', cursor: step === 1 ? 'not-allowed' : 'pointer',
              fontSize: 'var(--neo-font-size-base)', fontWeight: 700, color: step === 1 ? '#CBD5E1' : '#475569',
              opacity: step === 1 ? 0.5 : 1,
            }}
          >← 이전 단계</button>
          {step < 6 && (
            <button
              onClick={() => {
                if (!canNext()) return;
                // [v2.12] 단계 이동 시 자동 저장 — prototype 시뮬레이션
                showToast && showToast('저장됨');
                // Step 1 → 2: OCR 자동 감지 프로세스 (TSK-12 §3.3) 실행
                if (step === 1) {
                  runOcrDetection();
                  return;
                }
                setStep(step + 1);
              }}
              disabled={!canNext()}
              title={!canNext() ? '필수 조건을 충족해 주세요' : undefined}
              style={{
                padding: '10px 22px', borderRadius: '10px', border: 'none',
                background: canNext() ? '#2A75F3' : '#CBD5E1',
                color: 'white', cursor: canNext() ? 'pointer' : 'not-allowed',
                fontSize: 'var(--neo-font-size-base)', fontWeight: 800,
              }}
            >{step === 1 ? '🔍 자동 감지 시작 →' : '다음 단계 →'}</button>
          )}
        </div>
      </div>

      {/* 원본 이미지 플로팅 창 — 이동·크기조절 가능, 본문 입력 중에도 유지. 닫기 버튼으로만 종료 (오버레이 없음) */}
      {/* 저장 시 정합성 확인 모달 — 자율평가 채점기준 합 ≠ 총 배점 */}
      {saveMismatchModal && (
        <div onClick={() => setSaveMismatchModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 520, maxWidth: '92vw', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '18px 22px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <h2 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, margin: 0, color: '#1E293B' }}>채점 합계가 총 배점과 다릅니다</h2>
            </div>
            <div style={{ padding: '4px 22px 12px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.5 }}>
              <p style={{ margin: '0 0 10px' }}>다음 문항에서 채점기준 합계와 총 배점이 일치하지 않습니다. 의도된 가중치라면 그대로 저장하고, 실수였다면 균등 재분배 후 저장하세요.</p>
              <div style={{ background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, padding: '10px 12px', maxHeight: 240, overflowY: 'auto' }}>
                {saveMismatchModal.items.map((m) => (
                  <div key={m.qid} style={{ fontSize: 'var(--neo-font-size-sm)', color: '#92400E', marginBottom: 4 }}>
                    · <strong>문항 {m.idx}</strong> — 채점기준 합 <strong>{m.sum}점</strong> / 총 배점 <strong>{m.total}점</strong> <span style={{ color: '#B45309' }}>({m.diff > 0 ? '+' : ''}{m.diff}점)</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '0 22px 12px', fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8' }}>
              💡 정합성을 맞춰야 저장할 수 있습니다. 브라우저를 그냥 닫으면 균등 재분배 후 자동 저장됩니다.
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '12px 22px 18px', justifyContent: 'flex-end', borderTop: '1px solid #F1F5F9', flexWrap: 'wrap' }}>
              <button onClick={() => setSaveMismatchModal(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>돌아가서 수정</button>
              <button onClick={redistributeAllAndSave} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: '#10B981', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}>↻ 모든 문항 균등 재분배 후 저장</button>
            </div>
          </div>
        </div>
      )}

      {imgWin && (
        <div style={{
          position: 'fixed', left: winPos.x, top: winPos.y, zIndex: 55,
          width: 400, height: 440, minWidth: 220, minHeight: 200,
          resize: 'both', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          background: 'white', borderRadius: 12, border: '1px solid #CBD5E1',
          boxShadow: '0 18px 48px rgba(15,23,42,0.28)',
        }}>
          <div onMouseDown={startWinDrag} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
            background: '#1E293B', color: 'white', cursor: 'move', flexShrink: 0, userSelect: 'none',
          }}>
            <span style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800 }}>🖼 문항 {imgWin.idx + 1} · 원본 이미지</span>
            <button onClick={() => setImgWin(null)} title="닫기"
              style={{ marginLeft: 'auto', width: 24, height: 24, borderRadius: 6, border: 'none', background: 'rgba(255,255,255,0.18)', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-base)', cursor: 'pointer', lineHeight: 1 }}>✕</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: 10, background: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
            <img src={imgWin.src} alt={`문항 ${imgWin.idx + 1} 원본`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 6, background: 'white', boxShadow: '0 1px 4px rgba(15,23,42,0.12)' }} />
          </div>
          <div style={{ flexShrink: 0, padding: '5px 10px', fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', background: 'white', borderTop: '1px solid #E2E8F0', textAlign: 'right' }}>↘ 모서리를 끌어 크기 조절 · 제목을 끌어 이동</div>
        </div>
      )}

      {/* OCR 자동 감지 진행 모달 (TSK-12 §3.3 — stub. 실제 OCR API 미연동) */}
      {ocrModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(2px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            width: '440px', maxWidth: '92vw',
            background: 'white', borderRadius: '16px',
            boxShadow: '0 24px 60px rgba(15,23,42,0.30)',
            padding: '24px 24px 18px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <span style={{ fontSize: '1.4rem' }}>🔍</span>
              <h3 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 900, margin: 0, color: '#1E293B' }}>문답지를 분석하고 있습니다</h3>
            </div>
            <p style={{ fontSize: 'var(--neo-font-size-sm)', color: '#64748B', margin: '0 0 16px', lineHeight: 1.55 }}>
              자동 감지가 완료되면 영역 편집 단계에서 결과를 확인하고 잘못된 부분만 수정할 수 있습니다.
              <br />
              <span style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8' }}>※ 프로토타입 — 실제 OCR API는 미연동, 데모용 가짜 결과가 표시됩니다.</span>
            </p>
            <div style={{ marginBottom: '8px', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, color: '#1D4ED8' }}>
              {ocrModal.stage}
            </div>
            <div style={{
              height: '10px', background: '#E2E8F0', borderRadius: '999px', overflow: 'hidden', marginBottom: '6px',
            }}>
              <div style={{
                width: `${ocrModal.progress}%`, height: '100%',
                background: 'linear-gradient(90deg, #60A5FA, #2A75F3)',
                borderRadius: '999px', transition: 'width 0.4s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '14px' }}>
              <span style={{ fontSize: 'var(--neo-font-size-sm)', color: '#94A3B8', fontWeight: 700 }}>{ocrModal.progress}%</span>
              <button
                onClick={skipOcrDetection}
                style={{
                  padding: '8px 14px', borderRadius: '8px',
                  border: '1px solid #E2E8F0', background: 'white',
                  color: '#475569', fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer',
                }}
              >건너뛰기</button>
            </div>
          </div>
        </div>
      )}

      {/* [v2.15] AI 개선 결과 모달 (TSK-13과 동일 패턴) */}
      {aiImprove && (
        <div onClick={() => setAiImprove(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 860, maxWidth: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #E2E8F0' }}>
              <h2 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, margin: 0 }}>AI 개선 결과</h2>
              <button onClick={() => setAiImprove(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 'var(--neo-font-size-xl)', color: '#94A3B8' }}>✕</button>
            </div>
            <div style={{ padding: '18px 20px', overflowY: 'auto' }}>
              <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#475569', display: 'block', marginBottom: 6 }}>원본 문항 내용</label>
              <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 14px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.7, background: '#F8FAFC', whiteSpace: 'pre-wrap', marginBottom: 16 }}>{aiImprove.original}</div>
              <label style={{ fontSize: 'var(--neo-font-size-sm)', fontWeight: 800, color: '#1D4ED8', display: 'block', marginBottom: 6 }}>AI 개선 내용 <span style={{ color: '#94A3B8', fontWeight: 600 }}>(직접 수정 가능 · 샘플)</span></label>
              <textarea value={aiImprove.improved} onChange={(e) => setAiImprove((p) => ({ ...p, improved: e.target.value }))}
                style={{ width: '100%', minHeight: 120, border: '1px solid #BFDBFE', borderRadius: 8, padding: '12px 14px', fontSize: 'var(--neo-font-size-sm)', color: '#1E2225', lineHeight: 1.7, resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', background: '#F8FBFF' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, padding: '14px 20px', borderTop: '1px solid #E2E8F0' }}>
              <button onClick={() => setAiImprove(null)} style={{ padding: '10px 24px', borderRadius: 10, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontWeight: 700, cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)' }}>취소</button>
              <button onClick={applyAiImprove} style={{ padding: '10px 26px', borderRadius: 10, border: 'none', background: '#2A75F3', color: 'white', fontWeight: 800, cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)' }}>적용하기</button>
            </div>
          </div>
        </div>
      )}

      {/* [v2.18 → v2.19] 파일 교체 확인 모달 — Step 2+ 진행 이력 있는 상태에서 새 파일 업로드 시 확인 (TSK-12:파일재업로드확인) */}
      {pendingFile && (
        <div onClick={() => setPendingFile(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9550, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 500, maxWidth: '92vw', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '18px 22px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <h2 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, margin: 0, color: '#1E293B' }}>파일을 변경하시겠습니까?</h2>
            </div>
            <div style={{ padding: '4px 22px 14px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 10px' }}>다른 파일로 교체하면 <strong style={{ color: '#DC2626' }}>현재 작성된 모든 내용이 초기화</strong>되고 Step 1로 돌아갑니다.</p>
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#B91C1C', fontWeight: 700, marginBottom: 6 }}>초기화 대상</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--neo-font-size-sm)', color: '#7F1D1D', lineHeight: 1.7 }}>
                  <li>문항·지문 영역 (캔버스 박스)</li>
                  <li>모든 문항 본문</li>
                  <li>핵심평가영역·성취기준·모범답안</li>
                  <li>자율평가 채점 기준·배점</li>
                  <li>OCR 인식 결과</li>
                </ul>
              </div>
              <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', marginBottom: 4 }}>새 파일</div>
                <div style={{ fontWeight: 700, color: '#1E293B', wordBreak: 'break-all' }}>{pendingFile.name}</div>
                <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', marginTop: 2 }}>{(pendingFile.size / 1024).toFixed(1)} KB · {pendingFile.type}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 22px', borderTop: '1px solid #E2E8F0' }}>
              <button
                onClick={() => setPendingFile(null)}
                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}
              >취소</button>
              <button
                onClick={async () => {
                  const file = pendingFile;
                  setPendingFile(null);
                  await loadFile(file);
                }}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#EF4444', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}
              >확인 — 모두 초기화</button>
            </div>
          </div>
        </div>
      )}

      {/* [v2.20] 파일 제거 확인 모달 — Step 2+ 진행 이력 있는 상태에서 파일 제거 시 확인 (TSK-12:파일제거확인) */}
      {pendingRemove && (
        <div onClick={() => setPendingRemove(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 9550, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 500, maxWidth: '92vw', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '18px 22px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.5rem' }}>⚠️</span>
              <h2 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, margin: 0, color: '#1E293B' }}>파일을 제거하시겠습니까?</h2>
            </div>
            <div style={{ padding: '4px 22px 14px', fontSize: 'var(--neo-font-size-sm)', color: '#475569', lineHeight: 1.6 }}>
              <p style={{ margin: '0 0 10px' }}>파일을 제거하면 <strong style={{ color: '#DC2626' }}>현재 작성된 모든 내용이 초기화</strong>되고 Step 1로 돌아갑니다.</p>
              <div style={{ background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
                <div style={{ fontSize: 'var(--neo-font-size-sm)', color: '#B91C1C', fontWeight: 700, marginBottom: 6 }}>초기화 대상</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--neo-font-size-sm)', color: '#7F1D1D', lineHeight: 1.7 }}>
                  <li>업로드된 파일</li>
                  <li>문항·지문 영역 (캔버스 박스)</li>
                  <li>모든 문항 본문</li>
                  <li>핵심평가영역·성취기준·모범답안</li>
                  <li>자율평가 채점 기준·배점</li>
                  <li>OCR 인식 결과</li>
                </ul>
              </div>
              {uploadedFile && (
                <div style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', marginBottom: 4 }}>제거되는 파일</div>
                  <div style={{ fontWeight: 700, color: '#1E293B', wordBreak: 'break-all' }}>{uploadedFile.name}</div>
                  <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#94A3B8', marginTop: 2 }}>{(uploadedFile.size / 1024).toFixed(1)} KB · {uploadedFile.type}</div>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 22px', borderTop: '1px solid #E2E8F0' }}>
              <button
                onClick={() => setPendingRemove(false)}
                style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid #E2E8F0', background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}
              >취소</button>
              <button
                onClick={() => {
                  setPendingRemove(false);
                  performRemoveFile();
                }}
                style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#EF4444', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-sm)', cursor: 'pointer' }}
              >확인 — 모두 초기화 및 제거</button>
            </div>
          </div>
        </div>
      )}

      {/* [v2.61] 성취기준 1→2 전환 경고 모달 폐기 — 통합 배너(좌:활용 + 우:주의)로 일원화 */}

      {/* [v2.17] 수식 입력 모달 — 평가내용 / 모범답안 통합 편집 (v2.22 target 분기 — TSK-13 v2.19와 동일 패턴) */}
      {formulaModal && (
        <FormulaModal
          initialLatex={formulaModal.initialContent}
          onCancel={() => setFormulaModal(null)}
          onConfirm={(newContent) => {
            if (formulaModal.target === 'modelAnswer') {
              const editor = document.querySelector(`[data-model-answer-editor="${formulaModal.qid}"]`);
              if (editor) {
                const formulaHtml = `<div data-formula="true">$$${newContent}$$</div>`;
                editor.innerHTML = (editor.innerHTML || '') + formulaHtml;
                updateModelAnswerHtml(formulaModal.qid, editor.innerHTML);
              }
            } else {
              updateRowDesc(formulaModal.qid, formulaModal.cid, formulaModal.ri, newContent);
            }
            setFormulaModal(null);
          }}
        />
      )}

      {/* [TSK-05 v2.30] 평가 답안지 미리보기 모달 */}
      <WorksheetPreviewModal
        open={worksheetPreviewOpen}
        onClose={() => setWorksheetPreviewOpen(false)}
        subject={basicInfo?.subject || '국어'}
        taskTitle={basicInfo?.title || '과제명'}
      />

      {/* [TSK-05 v3.4] 스마트펜 번호표 미리보기 모달 */}
      <NumberTagPreviewModal
        open={numberTagPreviewOpen}
        onClose={() => setNumberTagPreviewOpen(false)}
        subject={basicInfo?.subject || '수학'}
        taskTitle={basicInfo?.title || '과제명'}
      />
    </div>
  );
};

// ============================================================
// [v2.17] 자율평가 평가내용 에디터 (TSK-13 v2.16과 동일 구현)
//   [∑+ 수식] / chip 클릭 모두 onOpenEditor(평가내용 전체) 호출
// ============================================================
const EvalContentEditor = ({ desc, placeholder, onChange, onOpenEditor }) => {
  const parsed = React.useMemo(() => {
    if (!desc) return [];
    const parts = [];
    let i = 0;
    let formulaIdx = 0;
    desc.replace(/\$\$([^$]+)\$\$/g, (match, latex, offset) => {
      if (offset > i) parts.push({ type: 'text', value: desc.slice(i, offset) });
      parts.push({ type: 'formula', latex, formulaIdx });
      formulaIdx += 1;
      i = offset + match.length;
      return match;
    });
    if (i < desc.length) parts.push({ type: 'text', value: desc.slice(i) });
    return parts;
  }, [desc]);

  const handleTextChange = (textIdx, newText) => {
    let textOccurrence = 0;
    const newDesc = parsed.map((p) => {
      if (p.type === 'formula') return `$$${p.latex}$$`;
      const out = textOccurrence === textIdx ? newText : p.value;
      textOccurrence += 1;
      return out;
    }).join('');
    onChange(newDesc);
  };

  React.useEffect(() => {
    if (document.getElementById('formula-chip-style')) return;
    const style = document.createElement('style');
    style.id = 'formula-chip-style';
    style.textContent = `
      .formula-chip { position: relative; display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 4px; font-family: 'Courier New', monospace; font-size: var(--neo-font-size-sm); color: #1D4ED8; cursor: pointer; margin: 0 2px; white-space: nowrap; }
      .formula-chip:hover { background: #DBEAFE; border-color: #2A75F3; }
      .formula-chip::after { content: '✏'; opacity: 0; font-size: var(--neo-font-size-xs); transition: opacity 0.15s; margin-left: 4px; }
      .formula-chip:hover::after { opacity: 1; }
    `;
    document.head.appendChild(style);
  }, []);

  const hasContent = parsed.length > 0;
  let textOccurrence = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2, padding: '4px 6px', border: '1px solid #CBD5E1', borderRadius: 6, background: 'white', minHeight: 32, fontSize: 'var(--neo-font-size-sm)' }}>
      {!hasContent && (
        <input value="" placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1, border: 'none', outline: 'none', fontSize: 'var(--neo-font-size-sm)', minWidth: 80, padding: '4px 6px', fontFamily: 'inherit' }} />
      )}
      {hasContent && parsed.map((p, pi) => {
        if (p.type === 'text') {
          const currentTextIdx = textOccurrence;
          textOccurrence += 1;
          return (
            <input key={pi} value={p.value} onChange={(e) => handleTextChange(currentTextIdx, e.target.value)}
              style={{ border: 'none', outline: 'none', fontSize: 'var(--neo-font-size-sm)', padding: '4px 4px', fontFamily: 'inherit', flex: '0 1 auto', width: `${Math.max(p.value.length, 1) * 8 + 16}px`, minWidth: 16 }} />
          );
        }
        return (
          <span key={pi} className="formula-chip" title="클릭하여 평가내용 전체 편집 (수식 + 텍스트)"
            onClick={onOpenEditor}>
            📐 {p.latex}
          </span>
        );
      })}
      {/* [v2.65] 평가 내용 비우기 — 모범답안 [✕ 비우기] 패턴과 동일. 내용이 있을 때만 노출 */}
      {hasContent && (
        <button type="button" onClick={() => onChange('')} title="평가 내용을 비웁니다."
          style={{ marginLeft: 'auto', padding: '2px 6px', border: '1px solid #E2E8F0', background: 'white', color: '#94A3B8', borderRadius: 4, fontSize: 'var(--neo-font-size-xs)', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>✕ 비우기</button>
      )}
      <button type="button" onClick={onOpenEditor} title="평가내용 전체를 LaTeX 편집기로 열어 수식·텍스트를 함께 편집합니다"
        style={{ marginLeft: hasContent ? 0 : 'auto', padding: '2px 8px', border: '1px solid #BFDBFE', background: '#EFF6FF', color: '#1D4ED8', borderRadius: 4, fontSize: 'var(--neo-font-size-sm)', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>∑ 수식</button>
    </div>
  );
};

// ============================================================
// [v2.17] 수식 입력 모달 — 평가내용 통합 편집기 (TSK-13 v2.16과 동일 구현)
//   평가내용 전체(텍스트 + $$LaTeX$$ 마커)를 통째 로드/편집/저장
// ============================================================
const FormulaModal = ({ initialLatex, onCancel, onConfirm }) => {
  const [latex, setLatex] = React.useState(initialLatex || '');
  const insertTemplate = (tpl) => { setLatex((prev) => prev ? `${prev} $$${tpl}$$` : `$$${tpl}$$`); };
  const toolbarBtnStyle = { padding: '6px 10px', border: '1px solid #E2E8F0', background: 'white', borderRadius: 4, cursor: 'pointer', fontSize: 'var(--neo-font-size-sm)', color: '#475569', fontWeight: 600, fontFamily: 'inherit' };
  // 미리보기 파싱
  const previewParts = React.useMemo(() => {
    if (!latex) return [];
    const parts = [];
    let i = 0;
    latex.replace(/\$\$([^$]+)\$\$/g, (match, lx, offset) => {
      if (offset > i) parts.push({ type: 'text', value: latex.slice(i, offset) });
      parts.push({ type: 'formula', latex: lx });
      i = offset + match.length;
      return match;
    });
    if (i < latex.length) parts.push({ type: 'text', value: latex.slice(i) });
    return parts;
  }, [latex]);
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 9500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, width: 720, maxWidth: '92vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 40px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 22px', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ flex: 1 }} />
          <h2 style={{ fontSize: 'var(--neo-font-size-base)', fontWeight: 800, margin: 0, color: '#1E293B' }}>수식 입력</h2>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onCancel} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 'var(--neo-font-size-xl)', color: '#94A3B8' }}>✕</button>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 22px', borderBottom: '1px solid #E2E8F0', background: '#F8FAFC' }}>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('+ - × ÷ ▲')}>+−×÷ ▲</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('{a} OVER {b} ▲')}>{'{}—{} ▲'}</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('SQRT{ } ▲')}>√▢ ▲</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('INT_{ }^{ } ▲')}>∫▢ ▲</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('SUM_{ }^{ } ▲')}>∑▢ ▲</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('sin{ } ▲')}>sin▢ ▲</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('lim_{ } ▲')}>lim▢ ▲</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('({ }) ▲')}>(▢) ▲</button>
          <button style={toolbarBtnStyle} onClick={() => insertTemplate('MATRIX{ } ▲')}>▢▢ ▲</button>
        </div>
        <div style={{ flex: 1, minHeight: 200, padding: '24px', background: 'white', borderBottom: '1px solid #E2E8F0', overflowY: 'auto' }}>
          {previewParts.length > 0 ? (
            <div style={{ fontSize: 'var(--neo-font-size-base)', color: '#1E293B', lineHeight: 1.8, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
              {previewParts.map((p, pi) => p.type === 'text' ? (
                <span key={pi} style={{ whiteSpace: 'pre-wrap' }}>{p.value}</span>
              ) : (
                <span key={pi} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 4, fontFamily: 'Cambria Math, Latin Modern Math, serif', fontSize: 'var(--neo-font-size-lg)', color: '#1D4ED8' }}>📐 {p.latex}</span>
              ))}
            </div>
          ) : (
            <div style={{ color: '#CBD5E1', fontSize: 'var(--neo-font-size-sm)', textAlign: 'center', marginTop: '60px' }}>아래 입력 영역에 평가내용을 작성하면 여기에 미리보기가 표시됩니다.</div>
          )}
        </div>
        <div style={{ padding: '12px 22px', background: '#F8FAFC' }}>
          <div style={{ fontSize: 'var(--neo-font-size-xs)', color: '#64748B', marginBottom: 6 }}>
            💡 텍스트와 수식을 함께 입력할 수 있습니다. 수식은 <code style={{ background: 'white', padding: '1px 6px', borderRadius: 3, border: '1px solid #E2E8F0', fontFamily: 'monospace' }}>$$LaTeX$$</code> 형식으로 감쌉니다. 툴바 버튼은 마커를 자동 삽입합니다.
          </div>
          <textarea value={latex} onChange={(e) => setLatex(e.target.value)}
            placeholder="예: 학생의 답안이 $$ {a} OVER {b} $$ 형태로 정확히 표현된 경우 만점"
            style={{ width: '100%', minHeight: 100, padding: '10px 12px', border: '1px solid #E2E8F0', borderRadius: 6, fontSize: 'var(--neo-font-size-sm)', fontFamily: 'Courier New, monospace', resize: 'vertical', boxSizing: 'border-box', background: 'white', lineHeight: 1.6 }} />
        </div>
        <div style={{ display: 'flex', gap: 12, padding: '14px 22px', borderTop: '1px solid #E2E8F0' }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '12px', border: '1px solid #E2E8F0', borderRadius: 8, background: 'white', color: '#475569', fontWeight: 700, fontSize: 'var(--neo-font-size-base)', cursor: 'pointer' }}>취소</button>
          <button onClick={() => onConfirm(latex)} style={{ flex: 1, padding: '12px', border: 'none', borderRadius: 8, background: '#2A75F3', color: 'white', fontWeight: 800, fontSize: 'var(--neo-font-size-base)', cursor: 'pointer' }}>입력</button>
        </div>
      </div>
    </div>
  );
};

export default TaskFileUploadWizard;
