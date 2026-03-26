import React, { useState, useRef } from 'react';
import './index.css';
import { renderMetadataImage } from './strokeMetadata.js';

// ─────────────────────────────────────────────────────────
//  Default Prompts & Mock Data
// ─────────────────────────────────────────────────────────
const DEFAULT_OCR_PROMPT = `Please transcribe the handwritten Korean text from the provided image precisely.
Keep the original structure and include any mathematical notations in LaTeX format if possible.`;

const DEFAULT_SYSTEM_PROMPTS = {
  '국어': `## [Role]
You are an expert Korean language educator and AI grading engine.

## [Objective]
Analyze the student's answer based on the provided Model Answer and Grading Criteria.
Provide a grade and constructive feedback.

## [Grading Logic]
1. Compare the OCR-transcribed student answer with the Model Answer.
2. Check for key literary terms, logical flow, and author's intent analysis.
3. Be encouraging but precise in your feedback.`,

  '수학': `## [Role]
You are an expert mathematics educator and AI grading engine.

## [Objective]
Analyze the student's answer based on the provided Model Answer and Grading Criteria.
Provide a grade and constructive feedback.

## [Grading Logic]
1. Compare the OCR-transcribed student answer with the Model Answer.
2. Check the accuracy of each calculation step and the final answer.
3. Partial credit may apply if the process is correct but the final answer is wrong.`,

  '과학': `## [Role]
You are an expert science educator and AI grading engine.

## [Objective]
Analyze the student's answer based on the provided Model Answer and Grading Criteria.
Provide a grade and constructive feedback.

## [Grading Logic]
1. Compare the OCR-transcribed student answer with the Model Answer.
2. Verify that key scientific concepts and required elements are mentioned.
3. Be encouraging but precise in your feedback.`,

  '기본': `## [Role]
You are an expert educator and AI grading engine.

## [Objective]
Analyze the student's answer based on the provided Model Answer and Grading Criteria.
Provide a grade and constructive feedback.

## [Grading Logic]
1. Compare the OCR-transcribed student answer with the Model Answer.
2. Apply the Grading Criteria strictly.
3. Be encouraging but precise in your feedback.`,
};

// 정량평가(과정평가) 전용 프롬프트
const DEFAULT_PROCESS_PROMPTS = {
  '수학': `## [Role]
You are an expert mathematics educator specializing in process-based evaluation.

## [Objective]
Evaluate the student's problem-solving process using the stroke-by-stroke handwriting data provided.
Focus on the thinking process, not just the final answer.

## [Grading Logic]
1. Analyze each step of the student's written work from the JSON stroke data.
2. Evaluate logical flow, formula application, and intermediate steps.
3. Award partial credit for correct reasoning even if the final answer is wrong.
4. Provide specific feedback on which steps were correct or incorrect.`,

  '기본': `## [Role]
You are an expert educator specializing in process-based (qualitative) evaluation.

## [Objective]
Evaluate the student's problem-solving process using the provided handwriting data.

## [Grading Logic]
1. Analyze the student's written work step by step.
2. Evaluate logical reasoning, process clarity, and concept application.
3. Award partial credit based on the quality of the process.`,
};

const EVAL_TYPES = ['정성평가', '정량평가'];

const DEFAULT_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPTS['기본'];

const getVersionsKey = (subject, evalType) =>
  `sg_prompt_versions_${subject || '기본'}_${evalType || '정성평가'}`;

const makeDefaultVersions = (subject, evalType) => {
  const systemPrompt = evalType === '정량평가'
    ? (DEFAULT_PROCESS_PROMPTS[subject] ?? '')
    : (DEFAULT_SYSTEM_PROMPTS[subject] ?? '');  // 미등록 교과는 빈값, 기본 폴백 없음
  const hasPrompt = !!systemPrompt;
  return [{
    id: hasPrompt ? 'v1' : '초기 세팅',
    datetime: hasPrompt ? getNowDatetime() : null,
    description: '',
    ocr: hasPrompt ? DEFAULT_OCR_PROMPT : '',
    system: systemPrompt,
    isLive: true,
    isInitial: !hasPrompt,  // 미등록 채널 표시용 플래그
  }];
};

const CURRENT_DOMAIN = 'neolab.net';
const SUBJECT_ORDER = ['국어', '수학', '과학', '영어', '사회', '역사', '도덕', '체육', '음악', '미술', '기술'];

const MOCK_ASSIGNMENTS = [
  { id: 'assign-001', label: '문학 지문 분석', type: '국어', schoolLevel: '중등', owner: 'teacher01@neolab.net', question: '다음 시의 주제와 작가의 의도를 서술하시오.', modelAnswer: '작품의 주제는 인간의 고독과 극복 의지이다. 작가는 자연물을 통해 인간의 내면 세계를 상징적으로 표현하고자 했다.', criteria: '- 핵심 키워드(고독, 극복) 포함 여부\n- 문장의 논리적 완결성\n- 작가의 의도 분석의 적절성' },
  { id: 'assign-002', label: '2차 방정식 풀이', type: '수학', schoolLevel: '중등', owner: 'teacher01@neolab.net', question: 'x^2 - 5x + 6 = 0의 해를 구하고 풀이 과정을 쓰시오.', modelAnswer: '(x-2)(x-3) = 0 따라서 x = 2 또는 x = 3.', criteria: '- 인수분해 과정의 정확성\n- 최종 해 도출 여부' },
  { id: 'assign-003', label: '광합성 작용 원리', type: '과학', schoolLevel: '초등', owner: 'teacher02@neolab.net', question: '광합성의 주요 단계와 필요한 요소를 설명하시오.', modelAnswer: '빛 에너지, 이산화탄소, 물을 이용하여 포도당과 산소를 생성하는 과정이다.', criteria: '- 필수 요소(빛, CO2, H2O) 명시\n- 생성물(포도당, 산소) 명시' },
  { id: 'assign-004', label: '소설 인물 분석', type: '국어', schoolLevel: '고등', owner: 'teacher02@neolab.net', question: '소설 속 주인공의 성격 변화를 서술하시오.', modelAnswer: '주인공은 초반 소극적 태도에서 갈등을 통해 적극적으로 변화한다.', criteria: '- 변화 전후 대비 서술\n- 갈등 요인 명시' },
  { id: 'assign-005', label: '함수의 극값', type: '수학', schoolLevel: '고등', owner: 'teacher01@neolab.net', question: 'f(x) = x³ - 3x의 극값을 구하시오.', modelAnswer: '극대 2 (x=-1), 극소 -2 (x=1)', criteria: '- 미분 과정 정확성\n- 극대/극소 값 정확성' },
  { id: 'assign-006', label: '뉴턴 운동 법칙', type: '과학', schoolLevel: '중등', owner: 'admin@other-school.net', question: '뉴턴의 운동 제2법칙을 설명하시오.', modelAnswer: 'F=ma, 힘은 질량과 가속도의 곱이다.', criteria: '- 공식 명시\n- 단위 포함' },
];

const getNowDatetime = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const PromptStudio = ({ onSaveArchive }) => {
  // --- States ---
  const [selectedAssignId, setSelectedAssignId] = useState('');
  const [question, setQuestion] = useState('');
  const [modelAnswer, setModelAnswer] = useState('');
  const [criteria, setCriteria] = useState('');

  const [studentImage, setStudentImage] = useState(null);
  const [ocrPrompt, setOcrPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  const [aiModel, setAiModel] = useState('Gemini 3.1 Pro');
  const [temp, setTemp] = useState(0.1);
  const [topP, setTopP] = useState(1.0);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [thinkingLevel, setThinkingLevel] = useState('Medium');
  const [gptThinking, setGptThinking] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [isSaved, setIsSaved] = useState(false);

  const [evalMatch, setEvalMatch] = useState('완전 일치');
  const [evalErrorType, setEvalErrorType] = useState('해당 없음');
  const [evalFeedback, setEvalFeedback] = useState('');

  const [exchangeRate, setExchangeRate] = useState(1350);
  const fileInputRef = useRef(null);

  // --- Version Effect & Handlers ---
  const [currentSubject, setCurrentSubject] = useState('');
  const [evalType, setEvalType] = useState('정성평가');
  const [promptVersions, setPromptVersions] = useState([]);
  const [activeVersionId, setActiveVersionId] = useState('v1');
  const [versionDescription, setVersionDescription] = useState('');
  const [isDraftMode, setIsDraftMode] = useState(false);

  const loadVersionsForChannel = (subject, type) => {
    const saved = localStorage.getItem(getVersionsKey(subject, type));
    const versions = saved ? JSON.parse(saved) : makeDefaultVersions(subject, type);
    setPromptVersions(versions);
    const liveVer = versions.find(v => v.isLive) ?? versions[0];
    setActiveVersionId(liveVer.id);
    setOcrPrompt(liveVer.ocr);
    setSystemPrompt(liveVer.system);
    setVersionDescription(liveVer.description ?? '');
    setIsDraftMode(false);
  };

  const handleEvalTypeChange = (type) => {
    if (!currentSubject) return;
    setEvalType(type);
    loadVersionsForChannel(currentSubject, type);
  };

  React.useEffect(() => {
    if (!currentSubject) return;
    localStorage.setItem(getVersionsKey(currentSubject, evalType), JSON.stringify(promptVersions));
  }, [promptVersions, currentSubject]);

  const handleVersionChange = (id) => {
    // 드래프트 버전은 버리고 제거
    setPromptVersions(prev => prev.filter(v => !v.isDraft));
    setActiveVersionId(id);
    setIsDraftMode(false);
    const v = promptVersions.find(v => v.id === id);
    if (v) {
      setOcrPrompt(v.ocr);
      setSystemPrompt(v.system);
      setVersionDescription(v.description ?? '');
    }
  };

  const startNewVersion = () => {
    const maxNum = promptVersions.reduce((max, v) => {
      const num = parseInt(v.id.replace('v', ''), 10) || 0;
      return Math.max(max, num);
    }, 0);
    const newId = `v${maxNum + 1}`;
    const draftVer = { id: newId, datetime: '시간 미정', description: '', ocr: '', system: '', isLive: false, isDraft: true };
    setPromptVersions(prev => [...prev, draftVer]);
    setActiveVersionId(newId);
    setOcrPrompt('');
    setSystemPrompt('');
    setVersionDescription('');
    setIsDraftMode(true);
  };

  const saveAsNewVersion = () => {
    const now = getNowDatetime();
    setPromptVersions(prev => prev.map(v =>
      v.id === activeVersionId
        ? { ...v, datetime: now, ocr: ocrPrompt, system: systemPrompt, description: versionDescription, isDraft: false }
        : v
    ));
    setVersionDescription('');
    setIsDraftMode(false);
    alert(`${activeVersionId} 버전이 저장되었습니다.`);
  };

  const applyToLive = () => {
    if (!window.confirm(`이 버전을 라이브 DB(실 서비스)에 적용하시겠습니까?`)) return;
    
    setPromptVersions(prev => prev.map(v => 
      v.id === activeVersionId ? { ...v, isLive: true } : { ...v, isLive: false }
    ));
    alert('실제 서비스에 프롬프트가 적용되었습니다.');
  };

  const deleteVersion = () => {
    if (promptVersions.length <= 1) {
      alert('최소 1개의 프롬프트 버전은 필요합니다.');
      return;
    }
    const currentV = promptVersions.find(v => v.id === activeVersionId);
    if (currentV?.isLive) {
      alert('라이브로 적용된 버전은 삭제할 수 없습니다.');
      return;
    }
    
    if (window.confirm('현재 선택된 버전을 삭제하시겠습니까?')) {
      const filtered = promptVersions.filter(v => v.id !== activeVersionId);
      setPromptVersions(filtered);
      setActiveVersionId(filtered[0].id);
      setOcrPrompt(filtered[0].ocr);
      setSystemPrompt(filtered[0].system);
    }
  };
  const handleAssignChange = (id) => {
    setSelectedAssignId(id);
    const assign = MOCK_ASSIGNMENTS.find(a => a.id === id);
    if (assign) {
      setQuestion(assign.question);
      setModelAnswer(assign.modelAnswer);
      setCriteria(assign.criteria);

      // 채널(교과 × 평가유형) 버전 로드
      const subject = assign.type;
      setCurrentSubject(subject);
      setEvalType('정성평가');
      loadVersionsForChannel(subject, '정성평가');
    } else {
      setQuestion('');
      setModelAnswer('');
      setCriteria('');
      setCurrentSubject('');
      setPromptVersions([]);
    }
    setIsSaved(false);
  };

  const saveToArchive = () => {
    if (!result || isSaved) return;

    const currentAssign = MOCK_ASSIGNMENTS.find(a => a.id === selectedAssignId);

    const archiveItem = {
      id: `TC-${Date.now().toString().slice(-4)}`,
      assignmentId: selectedAssignId,
      title: `${currentAssign?.label || '미분류'} 테스트`,
      status: 'success',
      matchStatus: '', // 사용자가 아카이브에서 선택
      errorType: '',   // 사용자가 아카이브에서 선택
      category: currentAssign?.type || '일반',
      model: aiModel,
      evalMode: evalType,
      latency: result.latency,
      tokens: result.tokens,
      costUsd: result.costUsd,
      date: new Date().toISOString(),
      ocrText: result.ocrText,
      gradingResult: result.gradingResult,
      systemPrompt: systemPrompt,
      ocrPrompt: ocrPrompt,
      modelAnswer: modelAnswer,
      studentAnswer: "OCR 변환 텍스트 참조",
      matchStatus: evalMatch,
      errorType: evalErrorType,
      teacherFeedback: evalFeedback,
      promptVersionId: activeVersionId,
      promptVersionDatetime: promptVersions.find(v => v.id === activeVersionId)?.datetime ?? '',
      promptSubject: currentSubject
    };

    onSaveArchive(archiveItem);
    setIsSaved(true);
    alert('테스트 결과가 아카이브에 저장되었습니다. [Prompt 아카이브] 메뉴에서 분석을 진행하세요.');
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.name.endsWith('.json')) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const raw = JSON.parse(ev.target.result);
          const strokes = raw[0]?.strokes ?? [];
          if (strokes.length === 0) throw new Error('획 데이터가 없습니다.');
          const canvas = renderMetadataImage(strokes);
          canvas.toBlob((blob) => {
            if (blob) {
              setStudentImage(URL.createObjectURL(blob));
              setIsSaved(false);
            }
          });
        } catch (err) {
          alert('JSON 파싱 오류: ' + (err instanceof Error ? err.message : '알 수 없는 오류'));
        }
      };
      reader.readAsText(file);
    } else {
      setStudentImage(URL.createObjectURL(file));
      setIsSaved(false);
    }
  };

  const refreshExchangeRate = () => {
    const newRate = 1300 + Math.floor(Math.random() * 100);
    setExchangeRate(newRate);
  };

  const executeAI = async () => {
    setIsRunning(true);
    setResult(null);
    setIsSaved(false);
    setEvalMatch('완전 일치');
    setEvalErrorType('해당 없음');
    setEvalFeedback('');

    await new Promise(r => setTimeout(r, 2000));

    const mockOutput = {
      ocrText: "작품의 주제는 인간의 외로움과 그것을 이겨내려는 마음입니다. 자연을 빌려 마음을 그렸습니다.",
      gradingResult: "{\n  \"grade\": \"우수 (A)\",\n  \"feedback\": \"키워드인 고독과 극복 의지를 잘 파악했습니다.\"\n}",
      latency: "2.42s",
      tokens: { input: 420, output: 156, total: 576 },
      costUsd: 0.00085
    };

    setResult(mockOutput);
    setIsRunning(false);
  };

  return (
    <div className="sg-root">
      <header className="sg-header">
        <h1 className="sg-title">Prompt Studio</h1>
        <p className="sg-subtitle">문항 선택부터 AI 정밀 분석까지 원스톱 채점 자동화를 경험하세요.</p>
      </header>

      <div className="sg-container">
        {/* Left: Input Pipeline */}
        <div className="sg-pipeline">
          <div className="sg-step-line"></div>

          {/* Step 1: 과제 선택 */}
          <div className="sg-step-card">

            <div className="sg-card-content">
              <div className="sg-card-header">
                <span className="sg-card-label">등록 문항 선택</span>
                <span className="sg-card-badge-req">필수</span>
              </div>
              <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
                {MOCK_ASSIGNMENTS
                  .filter(a => a.owner?.endsWith(CURRENT_DOMAIN))
                  .sort((a, b) => {
                    const ai = SUBJECT_ORDER.indexOf(a.type);
                    const bi = SUBJECT_ORDER.indexOf(b.type);
                    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
                  })
                  .map(a => (
                    <div
                      key={a.id}
                      onClick={() => handleAssignChange(a.id)}
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        fontSize: '0.875rem',
                        borderBottom: '1px solid #f1f5f9',
                        background: selectedAssignId === a.id ? '#EBF2FF' : 'transparent',
                        color: selectedAssignId === a.id ? '#2A75F3' : '#334155',
                        fontWeight: selectedAssignId === a.id ? '600' : 'normal',
                      }}
                    >
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginRight: '6px' }}>[{a.schoolLevel}-{a.type}]</span>
                      {a.label}
                    </div>
                  ))
                }
              </div>

              {selectedAssignId && (
                <div className="sg-loaded-data">
                  <div className="sg-data-row"><strong>[문제]</strong> {question}</div>
                  <div className="sg-data-row"><strong>[모범답안]</strong> {modelAnswer}</div>
                  <div className="sg-data-row"><strong>[채점기준]</strong> {criteria}</div>
                </div>
              )}
            </div>
          </div>

          {/* Step 2: 학생 답안 업로드 */}
          <div className="sg-step-card">

            <div className="sg-card-content">
              <div className="sg-card-header">
                <span className="sg-card-label">학생 답안 업로드 (이미지 또는 JSON)</span>
                <span className="sg-card-badge-req">필수 (1건)</span>
              </div>
              <div
                className="sg-upload-zone"
                onClick={() => fileInputRef.current.click()}
              >
                <input type="file" hidden ref={fileInputRef} accept="image/*,.json" onChange={handleFileChange} />
                {studentImage ? (
                  <div className="sg-preview-container">
                    <img src={studentImage} alt="Preview" className="sg-preview-img" style={{ maxWidth: '100%', borderRadius: '8px' }} />
                    <button
                      className="sg-btn-delete-img"
                      onClick={(e) => {
                        e.stopPropagation();
                        setStudentImage(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      title="이미지 삭제"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="sg-upload-icon">📸</div>
                    <div className="sg-upload-text">학생 답안 이미지 또는 JSON 필기 데이터를 업로드하세요</div>
                    <div className="sg-upload-sub">1. 일반 사진(JPG, PNG 등)<br/>2. NeoStudio 필기 데이터(_strokes_parsed.json)</div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Step 3: 프롬프트 설정 */}
          <div className="sg-step-card">

            <div className="sg-card-content">
              <div className="sg-card-header" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="sg-card-label">시스템 프롬프트 (버전 관리)</span>
                    {/* 평가유형 채널 토글 */}
                    {currentSubject && (
                      <div style={{ display: 'flex', border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                        {EVAL_TYPES.map(type => (
                          <button
                            key={type}
                            onClick={() => handleEvalTypeChange(type)}
                            style={{
                              padding: '3px 10px',
                              fontSize: '0.75rem',
                              fontWeight: evalType === type ? '700' : '400',
                              border: 'none',
                              background: evalType === type ? '#334155' : '#f8fafc',
                              color: evalType === type ? '#fff' : '#64748b',
                              cursor: 'pointer',
                            }}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {/* Live 상태 표시 — 버전 드롭다운 앞 (draft 중엔 숨김) */}
                    {!isDraftMode && selectedAssignId && (
                      promptVersions.find(v => v.id === activeVersionId)?.isLive ? (
                        <span style={{ fontSize: '0.8rem', color: '#10B981', fontWeight: '700', padding: '0 4px', whiteSpace: 'nowrap' }}>🚀 현재 Live 모델</span>
                      ) : (
                        <>
                          <button className="sg-btn-reset-prompt" onClick={applyToLive} style={{ background: '#EBF2FF', borderColor: '#2A75F3', color: '#2A75F3' }}>
                            ✔️ DB(Live) 적용
                          </button>
                          <button className="sg-btn-reset-prompt" onClick={deleteVersion} style={{ color: '#ef4444', borderColor: '#ef4444', background: '#fef2f2' }}>
                            🗑️ 삭제
                          </button>
                        </>
                      )
                    )}
                    <select
                      className="sg-select-full"
                      style={{ width: 'auto', minWidth: '160px', fontWeight: 'bold' }}
                      value={activeVersionId}
                      onChange={(e) => handleVersionChange(e.target.value)}
                    >
                      {promptVersions.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.isInitial ? '등록 버전 없음' : v.isDraft ? `✏️ ${v.id} | 시간 미정 (미저장)` : `${v.id} | ${v.datetime ?? v.date ?? '날짜없음'}${v.isLive ? ' 🔴 Live' : ''}`}
                        </option>
                      ))}
                    </select>
                    {/* 새 버전 추가/저장 버튼 — 오른쪽 끝 */}
                    {isDraftMode ? (
                      <button className="sg-btn-reset-prompt" onClick={saveAsNewVersion} style={{ background: '#EBF2FF', color: '#2A75F3', borderColor: '#2A75F3', fontWeight: '700' }}>
                        💾 새 버전 저장
                      </button>
                    ) : (
                      <button className="sg-btn-reset-prompt" onClick={startNewVersion} style={{ background: '#f8fafc', color: '#475569', borderColor: '#cbd5e1' }}>
                        + 새 버전 추가
                      </button>
                    )}
                  </div>
                </div>
                {/* 버전 설명 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 10px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '0.78rem', color: '#64748b', whiteSpace: 'nowrap', fontWeight: '600' }}>📋 버전 설명</span>
                  <input
                    type="text"
                    placeholder={isDraftMode ? '이 버전의 변경 내용을 간단히 메모하세요 (50자 이내)' : '저장된 내용이 없습니다.'}
                    maxLength={50}
                    value={versionDescription}
                    onChange={(e) => isDraftMode && setVersionDescription(e.target.value)}
                    readOnly={!isDraftMode}
                    style={{ flex: 1, border: 'none', background: 'transparent', fontSize: '0.82rem', color: isDraftMode ? '#334155' : '#94a3b8', outline: 'none', minWidth: 0, cursor: isDraftMode ? 'text' : 'default' }}
                  />
                </div>
              </div>
              <div className="sg-prompt-group">
                <label className="sg-prompt-label">OCR 프롬프트</label>
                <textarea
                  className="sg-textarea-small"
                  value={ocrPrompt}
                  onChange={(e) => setOcrPrompt(e.target.value)}
                  placeholder={
                    selectedAssignId
                      ? '등록된 OCR 프롬프트가 없습니다.'
                      : '문항을 선택하면 DB에 적용된 프롬프트 내용이 나옵니다.'
                  }
                />
              </div>
              <div className="sg-prompt-group">
                <label className="sg-prompt-label">채점 프롬프트 (System Prompt)</label>
                <textarea
                  className="sg-textarea-mid"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  placeholder={
                    selectedAssignId
                      ? '등록된 채점 프롬프트가 없습니다.'
                      : '문항을 선택하면 DB에 적용된 프롬프트 내용이 나옵니다.'
                  }
                />
              </div>
            </div>
          </div>

          {/* 결과 없을 때 안내 */}
          {selectedAssignId && !result && !isRunning && (
            <div style={{
              margin: '8px 0 0 0',
              padding: '20px',
              background: '#f8fafc',
              border: '1px dashed #cbd5e1',
              borderRadius: '10px',
              textAlign: 'center',
              color: '#94a3b8',
              fontSize: '0.875rem',
            }}>
              <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>📋</div>
              <div>아직 실행된 결과가 없습니다.</div>
              <div style={{ marginTop: '4px', fontSize: '0.8rem' }}>학생 답안을 업로드하고 <strong style={{ color: '#475569' }}>AI 실행</strong>을 눌러주세요.</div>
            </div>
          )}

          {/* Result Section (If present) */}
          {result && (
            <div className="sg-step-card result-fade-in">

              <div className="sg-card-content sg-result-card">
                <div className="sg-card-header">
                  <span className="sg-card-label" style={{ color: '#10B981' }}>📊 분석 완료</span>
                  <button
                    className={`sg-btn-archive ${isSaved ? 'saved' : ''}`}
                    onClick={saveToArchive}
                    disabled={isSaved}
                  >
                    {isSaved ? '✓ 아카이브 저장됨' : '📥 아카이브에 저장'}
                  </button>
                </div>

                <div className="sg-result-grid">
                  <div className="sg-res-box">
                    <label>OCR 변환 텍스트</label>
                    <div className="sg-res-text">{result.ocrText}</div>
                  </div>
                  <div className="sg-res-box">
                    <label>AI 채점 결과 (Raw)</label>
                    <pre className="sg-res-json">{result.gradingResult}</pre>
                  </div>
                </div>

                {/* AI 과정 평가 영역 */}
                <div className="sg-ai-eval-box" style={{ marginTop: '20px', padding: '16px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🎯</span> AI 채점 품질 평가 <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'normal' }}>(과정 평가)</span>
                  </h4>
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <div className="sg-prompt-group" style={{ flex: '1', minWidth: '200px' }}>
                      <label className="sg-prompt-label">평가 일치도</label>
                      <select className="sg-select-full" value={evalMatch} onChange={(e) => setEvalMatch(e.target.value)}>
                        <option>완전 일치</option>
                        <option>부분 일치</option>
                        <option>불일치</option>
                      </select>
                    </div>
                    <div className="sg-prompt-group" style={{ flex: '1', minWidth: '200px' }}>
                      <label className="sg-prompt-label">오류 유형 (불일치 시)</label>
                      <select className="sg-select-full" value={evalErrorType} onChange={(e) => setEvalErrorType(e.target.value)}>
                        <option>해당 없음</option>
                        <option>OCR 인식 오류</option>
                        <option>채점 기준표 미준수</option>
                        <option>환각 현상 (거짓 논리)</option>
                        <option>포맷 오류</option>
                      </select>
                    </div>
                  </div>
                  <div className="sg-prompt-group" style={{ marginTop: '12px' }}>
                    <label className="sg-prompt-label">연구진 코멘트 / 피드백</label>
                    <textarea 
                      className="sg-textarea-small" 
                      placeholder="AI가 틀린 부분이나 개선이 필요한 점을 적어주세요."
                      value={evalFeedback}
                      onChange={(e) => setEvalFeedback(e.target.value)}
                      style={{ height: '60px' }}
                    />
                  </div>
                </div>

                <div className="sg-metrics-footer">
                  <div className="sg-m-item"><strong>채점 시간:</strong> {result.latency}</div>
                  <div className="sg-m-item">
                    <strong>토큰:</strong> 입 {result.tokens.input} / 출 {result.tokens.output} (총 {result.tokens.total})
                  </div>
                  <div className="sg-m-item sg-cost-item">
                    <strong>비용:</strong> ${result.costUsd.toFixed(5)}
                    <span className="sg-cost-krw">/ {(result.costUsd * exchangeRate).toFixed(2)}원</span>
                    <button className="sg-btn-refresh" onClick={refreshExchangeRate} title="환율 동기화">↻</button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar: AI Config */}
        <aside className="sg-sidebar">
          <section className="sg-side-card">
            <div className="sg-side-title">🤖 AI 모델 선택</div>

            <div className="sg-model-group">
              <div className="sg-model-group-title" style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b', marginBottom: '8px', marginTop: '4px' }}>GPT 모델</div>
              <div className="sg-model-list">
                {['GPT-4o mini', 'GPT-5.3 Instant', 'GPT-5.4 Thinking', 'GPT-5.4 Pro'].map(m => (
                  <button
                    key={m}
                    className={`sg-model-pill ${aiModel === m ? 'active' : ''}`}
                    onClick={() => setAiModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <div className="sg-model-group" style={{ marginTop: '16px' }}>
              <div className="sg-model-group-title" style={{ fontSize: '0.85rem', fontWeight: '600', color: '#64748b', marginBottom: '8px' }}>Gemini 모델</div>
              <div className="sg-model-list">
                {['Gemini 3.1 Pro', 'Gemini 3.1 Flash-Lite'].map(m => (
                  <button
                    key={m}
                    className={`sg-model-pill ${aiModel === m ? 'active' : ''}`}
                    onClick={() => setAiModel(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="sg-side-card">
            <div className="sg-side-title">⚙️ 파라미터 설정</div>

            <div className="sg-param-row">
              <div className="sg-param-info">
                <span>temperature (창의성/일관성)</span>
                <span className="sg-v">{temp.toFixed(1)}</span>
              </div>
              <input type="range" min="0" max="1" step="0.1" value={temp} onChange={(e) => setTemp(parseFloat(e.target.value))} className="sg-range" />
            </div>

            <div className="sg-param-row">
              <div className="sg-param-info">
                <span>top_p (단어 선택 폭)</span>
                <span className="sg-v">{topP.toFixed(1)}</span>
              </div>
              <input type="range" min="0" max="1" step="0.1" value={topP} onChange={(e) => setTopP(parseFloat(e.target.value))} className="sg-range" />
            </div>


            <div className="sg-param-row">
              <div className="sg-param-info">
                <span>max_tokens (응답 길이)</span>
                <span className="sg-v">{maxTokens.toLocaleString()}</span>
              </div>
              <input type="range" min="100" max="8192" step="100" value={maxTokens} onChange={(e) => setMaxTokens(parseInt(e.target.value))} className="sg-range" />
            </div>

            {aiModel.includes('GPT') && (
              <div className="sg-param-row" style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="sg-param-info" style={{ marginBottom: 0 }}>
                  <span style={{ color: '#0f172a', fontWeight: '600' }}>🧠 thinking (사고 수준)</span>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500', color: '#4338ca' }}>
                  <input type="checkbox" checked={gptThinking} onChange={(e) => setGptThinking(e.target.checked)} style={{ marginRight: '6px', width: '16px', height: '16px' }} />
                  {gptThinking ? 'On' : 'Off'}
                </label>
              </div>
            )}

            {aiModel.includes('Gemini') && (
              <div className="sg-param-row" style={{ marginTop: '16px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div className="sg-param-info" style={{ marginBottom: '8px' }}>
                  <span style={{ color: '#0f172a', fontWeight: '600' }}>🧠 thinking_config (사고 수준)</span>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {['Minimal', 'Low', 'Medium', 'High'].map(level => (
                    <button
                      key={level}
                      onClick={() => setThinkingLevel(level)}
                      style={{
                        flex: 1,
                        padding: '6px 4px',
                        fontSize: '0.75rem',
                        fontWeight: '500',
                        border: '1px solid',
                        borderColor: thinkingLevel === level ? '#4338ca' : '#cbd5e1',
                        backgroundColor: thinkingLevel === level ? '#e0e7ff' : '#ffffff',
                        color: thinkingLevel === level ? '#4338ca' : '#64748b',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          <button
            className={`sg-execute-btn ${isRunning ? 'loading' : ''}`}
            disabled={isRunning || !selectedAssignId || !studentImage}
            onClick={executeAI}
          >
            {isRunning ? (
              <div className="sg-loading-wrap">
                <Spinner />
                <span>AI 채점 중...</span>
              </div>
            ) : (
              "AI 실행 (EXECUTE)"
            )}
          </button>

          {(!selectedAssignId || !studentImage) && !isRunning && (
            <p className="sg-warn-text">⚠️ 문항 선택과 답안 업로드가 완료되어야 실행할 수 있습니다.</p>
          )}
        </aside>
      </div>
    </div>
  );
};

const Spinner = () => <div className="sg-spinner"></div>;

export default PromptStudio;
