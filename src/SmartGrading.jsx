import React, { useState, useRef } from 'react';
import './index.css';

// ─────────────────────────────────────────────────────────
//  Default Prompts & Mock Data
// ─────────────────────────────────────────────────────────
const DEFAULT_SYSTEM_PROMPT = `## [Role]
You are an expert educator and AI grading engine.

## [Objective]
Analyze the student's answer based on the provided Model Answer and Grading Criteria.
Provide a grade and constructive feedback.

## [Grading Logic]
1. Compare the OCR-transcribed student answer with the Model Answer.
2. Apply the Grading Criteria strictly.
3. Be encouraging but precise in your feedback.`;

const DEFAULT_OCR_PROMPT = `Please transcribe the handwritten Korean text from the provided image precisely.
Keep the original structure and include any mathematical notations in LaTeX format if possible.`;

const MOCK_ASSIGNMENTS = [
  {
    id: 'assign-001',
    label: '[국어] 문학 지문 분석',
    type: '국어',
    question: '다음 시의 주제와 작가의 의도를 서술하시오.',
    modelAnswer: '작품의 주제는 인간의 고독과 극복 의지이다. 작가는 자연물을 통해 인간의 내면 세계를 상징적으로 표현하고자 했다.',
    criteria: '- 핵심 키워드(고독, 극복) 포함 여부\n- 문장의 논리적 완결성\n- 작가의 의도 분석의 적절성',
  },
  {
    id: 'assign-002',
    label: '[수학] 2차 방정식 풀이',
    type: '수학',
    question: 'x^2 - 5x + 6 = 0의 해를 구하고 풀이 과정을 쓰시오.',
    modelAnswer: '(x-2)(x-3) = 0 따라서 x = 2 또는 x = 3.',
    criteria: '- 인수분해 과정의 정확성\n- 최종 해 도출 여부',
  },
  {
    id: 'assign-003',
    label: '[과학] 광합성 작용 원리',
    type: '과학',
    question: '광합성의 주요 단계와 필요한 요소를 설명하시오.',
    modelAnswer: '빛 에너지, 이산화탄소, 물을 이용하여 포도당과 산소를 생성하는 과정이다.',
    criteria: '- 필수 요소(빛, CO2, H2O) 명시\n- 생성물(포도당, 산소) 명시',
  },
];

const SmartGrading = ({ onSaveArchive }) => {
  // --- States ---
  const [selectedAssignId, setSelectedAssignId] = useState('');
  const [question, setQuestion] = useState('');
  const [modelAnswer, setModelAnswer] = useState('');
  const [criteria, setCriteria] = useState('');

  const [studentImage, setStudentImage] = useState(null);
  const [ocrPrompt, setOcrPrompt] = useState(DEFAULT_OCR_PROMPT);
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);

  const [aiModel, setAiModel] = useState('Gemini 3.1 Pro');
  const [temp, setTemp] = useState(0.1);
  const [topP, setTopP] = useState(1.0);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [thinkingLevel, setThinkingLevel] = useState('Medium');
  const [gptThinking, setGptThinking] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [isSaved, setIsSaved] = useState(false);

  const [exchangeRate, setExchangeRate] = useState(1350);
  const fileInputRef = useRef(null);

  // --- Effect: Load Saved Defaults on Mount ---
  React.useEffect(() => {
    const savedOcr = localStorage.getItem('sg_default_ocr_prompt');
    const savedSystem = localStorage.getItem('sg_default_system_prompt');
    if (savedOcr) setOcrPrompt(savedOcr);
    if (savedSystem) setSystemPrompt(savedSystem);
  }, []);

  // --- Handlers ---
  const saveAsProjectDefault = () => {
    localStorage.setItem('sg_default_ocr_prompt', ocrPrompt);
    localStorage.setItem('sg_default_system_prompt', systemPrompt);
    alert('현재 프롬프트 내용이 기본값으로 저장되었습니다.\n이후 서비스 이용 시 해당 내용이 기본값으로 자동 반영됩니다.');
  };

  const restoreSavedDefault = () => {
    const savedOcr = localStorage.getItem('sg_default_ocr_prompt') || DEFAULT_OCR_PROMPT;
    const savedSystem = localStorage.getItem('sg_default_system_prompt') || DEFAULT_SYSTEM_PROMPT;

    if (window.confirm('저장된 기본값으로 복구하시겠습니까?\n(현재 작성 중인 프롬프트는 사라집니다.)')) {
      setOcrPrompt(savedOcr);
      setSystemPrompt(savedSystem);
    }
  };
  const handleAssignChange = (id) => {
    setSelectedAssignId(id);
    const assign = MOCK_ASSIGNMENTS.find(a => a.id === id);
    if (assign) {
      setQuestion(assign.question);
      setModelAnswer(assign.modelAnswer);
      setCriteria(assign.criteria);
    } else {
      setQuestion('');
      setModelAnswer('');
      setCriteria('');
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
      evalMode: '자동평가', // 기본값
      latency: result.latency,
      tokens: result.tokens,
      costUsd: result.costUsd,
      date: new Date().toISOString(),
      ocrText: result.ocrText,
      gradingResult: result.gradingResult,
      systemPrompt: systemPrompt,
      ocrPrompt: ocrPrompt,
      modelAnswer: modelAnswer,
      studentAnswer: "OCR 변환 텍스트 참조"
    };

    onSaveArchive(archiveItem);
    setIsSaved(true);
    alert('테스트 결과가 아카이브에 저장되었습니다. [Prompt 아카이브] 메뉴에서 분석을 진행하세요.');
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
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
            <div className="sg-step-num">1</div>
            <div className="sg-card-content">
              <div className="sg-card-header">
                <span className="sg-card-label">등록 문항 선택</span>
                <span className="sg-card-badge-req">필수</span>
              </div>
              <select
                className="sg-select-full"
                value={selectedAssignId}
                onChange={(e) => handleAssignChange(e.target.value)}
              >
                <option value="">— 문제를 선택하세요 —</option>
                {MOCK_ASSIGNMENTS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>

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
            <div className="sg-step-num">2</div>
            <div className="sg-card-content">
              <div className="sg-card-header">
                <span className="sg-card-label">학생 답안 이미지 업로드</span>
                <span className="sg-card-badge-req">필수 (이미지 1장)</span>
              </div>
              <div
                className="sg-upload-zone"
                onClick={() => fileInputRef.current.click()}
              >
                <input type="file" hidden ref={fileInputRef} accept="image/*" onChange={handleFileChange} />
                {studentImage ? (
                  <img src={studentImage} alt="Preview" className="sg-preview-img" />
                ) : (
                  <>
                    <div className="sg-upload-icon">📸</div>
                    <div className="sg-upload-text">학생 답안 이미지를 업로드하세요</div>
                    <div className="sg-upload-sub">파일을 클릭하거나 여기로 끌어다 놓으세요</div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Step 3: 프롬프트 설정 */}
          <div className="sg-step-card">
            <div className="sg-step-num">3</div>
            <div className="sg-card-content">
              <div className="sg-card-header">
                <span className="sg-card-label">시스템 프롬프트 (설정)</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className="sg-btn-reset-prompt"
                    style={{ background: '#EBF2FF', borderColor: '#2A75F3', color: '#2A75F3' }}
                    onClick={saveAsProjectDefault}
                  >
                    💾 현재 내용을 기본값으로 저장
                  </button>
                  <button
                    className="sg-btn-reset-prompt"
                    onClick={restoreSavedDefault}
                  >
                    ↺ 초기값으로 복구
                  </button>
                </div>
              </div>
              <div className="sg-prompt-group">
                <label className="sg-prompt-label">OCR 프롬프트</label>
                <textarea
                  className="sg-textarea-small"
                  value={ocrPrompt}
                  onChange={(e) => setOcrPrompt(e.target.value)}
                />
              </div>
              <div className="sg-prompt-group">
                <label className="sg-prompt-label">채점 프롬프트 (System Prompt)</label>
                <textarea
                  className="sg-textarea-mid"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Result Section (If present) */}
          {result && (
            <div className="sg-step-card result-fade-in">
              <div className="sg-step-num" style={{ background: '#10B981', color: 'white', borderColor: '#10B981' }}>✓</div>
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

export default SmartGrading;
