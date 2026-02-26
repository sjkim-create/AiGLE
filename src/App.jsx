import React, { useState } from 'react';
import './index.css';

function App() {
  const [activeMenu, setActiveMenu] = useState('과제 및 채점관리');
  const [activeSubMenu, setActiveSubMenu] = useState('채점 관리');
  const [selectedTask, setSelectedTask] = useState(1);
  const [activeTab, setActiveTab] = useState('전체');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [activeQuestion, setActiveQuestion] = useState(1);
  const [isScanUploadOpen, setIsScanUploadOpen] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([
    { id: 1, name: 'image (9).png', size: '79.33 KB' },
    { id: 2, name: 'image (8).png', size: '79.33 KB' },
    { id: 3, name: 'image (7).png', size: '172.98 KB' },
    { id: 4, name: 'aigle_icon.png', size: '34.8 KB' }
  ]);

  // 채점 확인 단계 전용 상태
  const [gradingHistory, setGradingHistory] = useState([
    { id: 1, label: '#1', level: '노력 (3단계)', feedback: '문장의 호응이 좋지 않아요. "이러다드..."와 같이 나름의 답변을 작성하려고 노력한 점은 긍정적이에요. 조금만 더 노력해보세요. 제시된 질문의 의도와 답변 내용의 텍스트가 부합하는 내용을 찾기가 어렵네요. 상세 설명에서 질문의 내용을 다시 읽고 천천히 읽어보고, 요구하는 핵심 키워드를 정확하게 파악하여 답변하는 연습을 해보아야 해요. 내용 분석 A, 지식 이해 및...' }
  ]);
  const [reflectedHistoryId, setReflectedHistoryId] = useState(1);
  const [teacherFinalFeedback, setTeacherFinalFeedback] = useState('');

  // 일괄 채점 관련 상태
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  
  // 일괄 채점 워크플로우 상태
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkStep, setBulkStep] = useState('checking'); // checking, not_installed, manual_install, instruction, final_bulk
  const [bulkStatus, setBulkStatus] = useState('ready'); // ready, processing, completed
  const [isNeoStudioInstalled, setIsNeoStudioInstalled] = useState(false);
  
  // 백그라운드 채점 및 알림 관련 상태
  const [isConfirmCloseOpen, setIsConfirmCloseOpen] = useState(false);
  const [showFAB, setShowFAB] = useState(false);
  const [isGradingFinished, setIsGradingFinished] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);
  const [isSettingsMode, setIsSettingsMode] = useState(false);
  const [activeSettingsMenu, setActiveSettingsMenu] = useState('환경설정');
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isFirmwareModalOpen, setIsFirmwareModalOpen] = useState(false);
  
  // 일괄 채점 전용 (크래들 연결 상태)
  const [penData, setPenData] = useState([
    { id: 'PEN-001', student: '홍길동1 (1학년 1반 1번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-002', student: '홍길동2 (1학년 1반 2번)', status: '펜 연결', data: '데이터 없음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-003', student: '홍길동3 (1학년 1반 3번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.0.5', needsUpdate: true },
    { id: 'PEN-005', student: '홍길동5 (1학년 1반 5번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-006', student: '홍길동6 (1학년 1반 6번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-007', student: '홍길동7 (1학년 1반 7번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
    { id: 'PEN-008', student: '홍길동8 (1학년 1반 8번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
    { id: 'PEN-009', student: '홍길동9 (1학년 1반 9번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    { id: 'PEN-010', student: '홍길동10 (1학년 1반 10번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
  ]);

  const [settingsPenData, setSettingsPenData] = useState(
    Array.from({ length: 30 }, (_, i) => ({
      mac: `00:1B:44:11:3A:${(i + 1).toString(16).padStart(2, '0').toUpperCase()}`,
      battery: `${Math.floor(Math.random() * 40) + 60}%`,
      firmware: i % 5 === 0 ? '2.0.8' : '2.1.0 (최신)',
      needsUpdate: i % 5 === 0
    }))
  );
  const [isUpdating, setIsUpdating] = useState(false);
  const [updatePercent, setUpdatePercent] = useState(0);

  // 모의 데이터 (Mock Data)
  const tasks = [
    { id: 1, type: '국어', title: '과제테스트', date: '2024.02.23', submissions: '0/10', description: '테스트' },
    { id: 2, type: '국어', title: '오늘 테스트 과제', date: '2024.02.24', submissions: '3/3', description: '오늘 테스트' }
  ];

  // 과제별 문항 (Mock: 최대 3개, 여기서는 2개로 설정하여 동적 탭 확인)
  const questions = [
    { id: 1, title: '문항 1', description: '작품의 주제를 파악하고 자신의 생각을 서술하시오.' },
    { id: 2, title: '문항 2', description: '주요 등장인물의 심리 변화를 분석하시오.' }
  ];

  const [students, setStudents] = useState([
    { id: 11, name: '정지훈', grade: '5학년 2반 3번', aiGrade: '노력', teacherGrade: '보통', status: '채점 확인' },
    { id: 1, name: '김순정', grade: '1학년 1반 1번', aiGrade: '-', teacherGrade: '-', status: '미채점' },
    { id: 2, name: '이순정', grade: '1학년 1반 2번', aiGrade: '-', teacherGrade: '-', status: '미채점' },
    { id: 3, name: '박순정', grade: '1학년 1반 3번', aiGrade: '-', teacherGrade: '-', status: '미채점' },
    { id: 9, name: '일반테스트', grade: '6학년 1반 1번', aiGrade: '노력', teacherGrade: '노력', status: '결과 발송 완료' },
    { id: 10, name: '이하늘', grade: '4학년 1반 1번', aiGrade: '노력', teacherGrade: '노력', status: '결과 발송 완료' }
  ]);

  const currentTask = tasks.find(t => t.id === selectedTask) || tasks[1];

  const handleOpenModal = (student) => {
    setSelectedStudent(student);
    setActiveQuestion(1);
    setIsModalOpen(true);
    // 상태 초기화
    if (student.status === '채점 확인') {
      setTeacherFinalFeedback('');
      setReflectedHistoryId(1);
    }
  };

  // 탭 필터링 로직
  const filteredStudents = students.filter(student => {
    if (activeTab === '전체') return true;
    if (activeTab === '미채점') return student.status === '미채점';
    if (activeTab === '채점 확인') return student.status === '채점 확인';
    if (activeTab === '결과 발송') return student.status === '결과 발송 완료';
    return true;
  });

  const getTabLabel = (label) => {
    const count = students.filter(s => {
      if (label === '전체') return true;
      if (label === '미채점') return s.status === '미채점';
      if (label === '채점 확인') return s.status === '채점 확인';
      if (label === '결과 발송') return s.status === '결과 발송 완료';
      return false;
    }).length;
    return `${label}(${count})`;
  };

  // 일괄 채점 핸들러
  const handleBulkGrading = () => {
    if (!selectedGroup || selectedGroup === '그룹 선택') {
      alert('그룹이 선택되어야 일괄 채점을 시작할 수 있습니다.');
      return;
    }
    
    // 워크플로우 시작: 설치 확인 모달 열기
    setIsBulkModalOpen(true);
    setBulkStep('checking');
    
    // 모의 확인 프로세스
    setTimeout(() => {
      if (!isNeoStudioInstalled) {
        setBulkStep('not_installed');
      } else {
        setBulkStep('instruction');
      }
    }, 1500);
  };

  const toggleAll = () => {
    const ungradedIds = students.filter(s => s.status === '미채점').map(s => s.id);
    if (selectedIds.length === ungradedIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(ungradedIds);
    }
  };

  const toggleStudent = (id) => {
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter(sid => sid !== id));
    } else {
      setSelectedIds([...selectedIds, id]);
    }
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
    setPenData([
      { id: 'PEN-001', student: '홍길동1 (1학년 1반 1번)', status: 'AI 채점중', progress: 40, data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-002', student: '홍길동2 (1학년 1반 2번)', status: 'AI 채점중', progress: 85, data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-003', student: '홍길동3 (1학년 1반 3번)', status: 'AI 채점 완료', data: '데이터 삭제', battery: '85%', firmware: '2.1.0 (최신)', completed: true },
      { id: 'PEN-004', student: '홍길동4 (1학년 1반 4번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-005', student: '홍길동5 (1학년 1반 5번)', status: '채점 실패', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isError: true },
      { id: 'PEN-006', student: '홍길동6 (1학년 1반 6번)', status: 'AI 채점중', progress: 60, data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-007', student: '홍길동7 (1학년 1반 7번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
      { id: 'PEN-008', student: '홍길동8 (1학년 1반 8번)', status: '중복 데이터', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)', isWarning: true },
      { id: 'PEN-009', student: '홍길동9 (1학년 1반 9번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
      { id: 'PEN-010', student: '홍길동10 (1학년 1반 10번)', status: '펜 연결', data: '데이터 있음', battery: '85%', firmware: '2.1.0 (최신)' },
    ]);

    // 서버 AI 채점 응답 타임아웃 (시뮬레이션: 5초)
    // 실제 서버 환경에서는 20분 등의 타임아웃 시간을 기반으로 완료 처리됨
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

      // 학생 목록 상태 업데이트: 성공하면 '채점 확인'으로 이동, 실패(id 3번 시뮬레이션)하면 '미채점' 유지
      setStudents(prev => prev.map(s => {
        if (selectedIds.includes(s.id)) {
          // 박순정(id:3) 학생은 실패하여 미채점에 남는 것으로 시뮬레이션
          if (s.id === 3) return s; 
          return { ...s, status: '채점 확인', aiGrade: '노력' };
        }
        return s;
      }));
      
      setSelectedIds([]); // 선택 초기화
    }, 5000);
  };

  const handleCloseProcessing = () => {
    if (bulkStatus === 'processing') {
      setIsConfirmCloseOpen(true);
    } else {
      setIsBulkModalOpen(false);
      setActiveTab('미채점'); // 완료 후 닫기 시 '미채점' 탭으로 이동
      setBulkStatus('ready');
      setIsGradingFinished(false);
    }
  };

  const proceedToBackground = () => {
    setIsConfirmCloseOpen(false);
    setIsBulkModalOpen(false);
    setShowFAB(true);
  };

  return (
    <div className="app-container">
      {/* --- 메인 사이드바 (좌측) --- */}
      <aside className="main-sidebar">
        <div className="logo-container">
          <img src="/images/logo.svg" alt="AiGLE" style={{ height: '32px' }} />
        </div>

        <div 
          className="user-profile" 
          style={{ marginBottom: '1rem', cursor: 'pointer', position: 'relative' }}
          onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
        >
          <div className="avatar">
            <img src="/assets/images/logo.svg" alt="Avatar" style={{ opacity: 0.2 }} />
          </div>
          <div className="user-info">
            <div className="name">[교사] 김 b</div>
            <div className="id">tch20261zim</div>
          </div>
          
          {isProfileDropdownOpen && (
            <div className="user-profile-dropdown" onClick={(e) => e.stopPropagation()}>
              <div className="dropdown-item" onClick={() => { setIsSettingsMode(true); setActiveSettingsMenu('내 정보'); setIsProfileDropdownOpen(false); }}>내 정보</div>
              <div className="dropdown-item" onClick={() => { setIsSettingsMode(true); setActiveSettingsMenu('환경설정'); setIsProfileDropdownOpen(false); }}>환경설정</div>
              <div className="dropdown-divider"></div>
              <div className="dropdown-item logout">로그아웃</div>
            </div>
          )}
        </div>

        <nav className="nav-menu">
          {!isSettingsMode ? (
            <>
              <div className={`nav-item ${activeMenu === '대시보드' ? 'active' : ''}`} onClick={() => setActiveMenu('대시보드')}>
                 📊 대시보드
              </div>
              <div className={`nav-item ${activeMenu === '학생' ? 'active' : ''}`} onClick={() => setActiveMenu('학생')}>
                 👥 학생 <span className="n-badge" style={{ marginLeft: 'auto', background: 'var(--success)' }}>N</span>
              </div>
              <div 
                className={`nav-item ${activeMenu === '과제 및 채점관리' ? 'active' : ''}`} 
                onClick={() => setActiveMenu('과제 및 채점관리')}
              >
                 📝 과제 및 채점관리 <span className="arrow">▼</span>
              </div>
              
              {activeMenu === '과제 및 채점관리' && (
                <div className="nav-sub-menu">
                  <div 
                    className={`nav-sub-item ${activeSubMenu === '과제 관리' ? 'active' : ''}`}
                    onClick={() => setActiveSubMenu('과제 관리')}
                  >
                    ⊙ 과제 관리 <span className="n-badge">N</span> <span className="badge">2</span>
                  </div>
                  <div 
                    className={`nav-sub-item ${activeSubMenu === '채점 관리' ? 'active' : ''}`}
                    onClick={() => setActiveSubMenu('채점 관리')}
                  >
                    ⊙ 채점 관리
                  </div>
                </div>
              )}
              <div className={`nav-item ${activeMenu === '게시판' ? 'active' : ''}`} onClick={() => setActiveMenu('게시판')}>
                 📋 게시판 <span className="n-badge" style={{ marginLeft: 'auto', background: 'var(--success)' }}>N</span>
              </div>
            </>
          ) : (
            <>
              <div 
                style={{ padding: '0.5rem 1.5rem', fontSize: '0.75rem', color: '#8A94A1', fontWeight: 700, cursor: 'pointer', marginBottom: '1rem' }}
                onClick={() => setIsSettingsMode(false)}
              >
                ← 서비스로 돌아가기
              </div>
              <div className={`nav-item ${activeSettingsMenu === '내 정보' ? 'active' : ''}`} onClick={() => setActiveSettingsMenu('내 정보')}>
                 👤 내 정보
              </div>
              <div className={`nav-item ${activeSettingsMenu === '고객센터' ? 'active' : ''}`} onClick={() => setActiveSettingsMenu('고객센터')}>
                 🎧 고객센터
              </div>
              <div className={`nav-item ${activeSettingsMenu === '환경설정' ? 'active' : ''}`} onClick={() => setActiveSettingsMenu('환경설정')}>
                 ⚙️ 환경설정
              </div>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <a href="#" className="footer-link">교사 이용 가이드 <span>›</span></a>
          <a href="#" className="footer-link">학생 이용 가이드 <span>›</span></a>
          <a href="#" className="footer-link">개인정보수집 이용 동의서<span>›</span></a>
        </div>
      </aside>

      {/* --- 메인 콘텐츠 영역 --- */}
      <main className="main-wrapper">
        {isSettingsMode ? (
          <div className="settings-container" style={{ padding: '2rem', height: '100%', overflowY: 'auto' }}>
            <header className="content-header" style={{ marginBottom: '2rem' }}>
              <div className="page-title">{activeSettingsMenu}</div>
            </header>

            {activeSettingsMenu === '환경설정' && (
              <div className="settings-content" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
                
                {/* 1. NeoStudio2Lite 다운로드 */}
                <section className="settings-card" style={{ background: 'white', padding: '1.5rem', borderRadius: '20px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>📦</div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem' }}>NeoStudio2Lite 관리</h3>
                  <p style={{ fontSize: '0.85rem', color: '#8A94A1', marginBottom: '1.5rem', flex: 1 }}>자동 전송 및 크래들 연결을 위한 전용 소프트웨어의 버전을 관리합니다.</p>
                  
                  <div style={{ background: '#F9FAFB', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>현재 버전: <span style={{ color: '#4E5968' }}>2.0.5</span></div>
                    <div style={{ fontSize: '0.8rem', color: '#8A94A1' }}>최신 버전: <span style={{ color: 'var(--primary)', fontWeight: 700 }}>2.1.0</span></div>
                  </div>
                  <button className="btn-primary" style={{ width: '100%', padding: '0.8rem' }}>최신 버전 다운로드</button>
                </section>

                {/* 2. 펌웨어 업데이트 */}
                <section className="settings-card" style={{ background: 'white', padding: '1.5rem', borderRadius: '20px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>🔌</div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem' }}>펜 펌웨어 업데이트</h3>
                  <p style={{ fontSize: '0.85rem', color: '#8A94A1', marginBottom: '1.5rem', flex: 1 }}>연결된 펜들의 펌웨어 상태를 확인하고 최신 버전으로 업데이트합니다.</p>
                  
                  <div style={{ background: '#F9FAFB', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>연결된 펜: <span style={{ color: 'var(--primary)' }}>{settingsPenData.length}개</span></div>
                    {settingsPenData.some(p => p.needsUpdate) && <span style={{ fontSize: '0.75rem', background: '#FFF1F2', color: '#FF4D4D', padding: '2px 8px', borderRadius: '4px', fontWeight: 800 }}>업데이트 필요</span>}
                  </div>
                  <button className="btn-primary" style={{ width: '100%', padding: '0.8rem', background: '#4E5968' }} onClick={() => setIsFirmwareModalOpen(true)}>펜 목록 및 업데이트 확인</button>
                </section>

                {/* 3. 초기화 버튼 */}
                <section className="settings-card" style={{ background: 'white', padding: '1.5rem', borderRadius: '20px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', display: 'flex', flexDirection: 'column', border: '1.5px solid #FFEBEE' }}>
                  <div style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>⚠️</div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 800, marginBottom: '0.5rem', color: '#991B1B' }}>기기 초기화</h3>
                  <p style={{ fontSize: '0.85rem', color: '#8A94A1', marginBottom: '1.5rem', flex: 1 }}>모든 펜의 데이터를 즉시 삭제하고 설정을 초기 상태로 되돌립니다.</p>
                  
                  <div style={{ background: '#FFF1F2', padding: '1rem', borderRadius: '12px', marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.8rem', color: '#991B1B', fontWeight: 600 }}>* 초기화 시 데이터 복구가 불가능합니다.</div>
                  </div>
                  <button 
                    className="btn-primary" 
                    style={{ width: '100%', padding: '0.8rem', background: '#EF4444' }}
                    onClick={() => setIsResetModalOpen(true)}
                  >
                    연결된 펜 전체 초기화
                  </button>
                </section>

              </div>
            )}

            {activeSettingsMenu !== '환경설정' && (
              <div style={{ textAlign: 'center', padding: '5rem', color: '#8A94A1' }}>
                <h3>{activeSettingsMenu} 페이지를 준비 중입니다.</h3>
              </div>
            )}
          </div>
        ) : (
          <>
            {activeSubMenu === '채점 관리' ? (
              <>
                <header className="content-header">
                  <div className="page-title">채점 관리</div>
                </header>

                <div className="content-body">
                  {/* --- 과제 선택 사이드바 --- */}
                  <aside className="sub-sidebar">
                    <div className="sub-sidebar-header">
                      <div style={{ fontSize: '0.85rem', fontWeight: 800, marginBottom: '0.75rem', color: '#1E2225' }}>과제 선택</div>
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

                  {/* --- 상세 채점 관리 영역 --- */}
                  <section className="detail-view">
                    <div className="task-info-banner" style={{ borderBottom: '1px solid #F3F4F6', paddingBottom: '1.5rem' }}>
                      <div className="info-left">
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 800 }}>[{currentTask.type}] {currentTask.title}</h2>
                        <div className="stats-summary" style={{ fontSize: '0.85rem', color: '#8A94A1' }}>
                          배포일: {currentTask.date} ∙ 1개 그룹 ∙ {students.length}명
                          <button className="btn-card-detail" style={{ width: 'auto', height: 'auto', padding: '2px 8px', marginLeft: '10px', fontSize: '0.75rem', borderRadius: '4px' }}>과제 상세보기 &gt;</button>
                        </div>
                      </div>
                      <div className="info-right">
                         <div className="stat-item" style={{ color: '#4E5968' }}>제출률 <span className="stat-value" style={{ color: 'var(--primary)', fontWeight: 800 }}>0%</span></div>
                         <div className="stat-item" style={{ color: '#4E5968' }}>완료율 <span className="stat-value" style={{ color: 'var(--primary)', fontWeight: 800 }}>100%</span></div>
                         <button className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.9rem' }}>채점 결과 내보내기</button>
                      </div>
                    </div>

                    <div className="control-bar">
                      <div className="tabs">
                        {['전체', '미채점', '채점 확인', '결과 발송'].map(tab => (
                          <div 
                            key={tab} 
                            className={`tab ${activeTab === tab ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab)}
                          >
                            {getTabLabel(tab)}
                          </div>
                        ))}
                      </div>
                      <div className="view-controls">
                        {activeTab === '미채점' && (
                          <label className="select-all-wrapper">
                            <input 
                              type="checkbox" 
                              checked={selectedIds.length > 0 && selectedIds.length === students.filter(s => s.status === '미채점').length}
                              onChange={toggleAll}
                            />
                            전체 선택
                          </label>
                        )}
                        <div className="btn-icon">🖿</div>
                        <div className="btn-icon">☰</div>
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
                      </div>
                    </div>

                    <div className="student-grid">
                      {filteredStudents.map(student => (
                        <div key={student.id} className="student-card">
                          {activeTab === '미채점' && (
                            <input 
                              type="checkbox" 
                              className="card-checkbox" 
                              checked={selectedIds.includes(student.id)}
                              onChange={() => toggleStudent(student.id)}
                            />
                          )}
                          <div className={`card-badge ${student.status === '미채점' ? 'badge-red-soft' : 'badge-blue-soft'}`}>
                            {student.status}
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
                          </div>
                          <button className="btn-card-detail" onClick={() => handleOpenModal(student)}>상세보기</button>
                        </div>
                      ))}
                    </div>

                    {/* 일괄 채점 플로팅 버튼 */}
                    {activeTab === '미채점' && selectedIds.length > 0 && (
                      <div className="bulk-button-container">
                        <button className="btn-bulk-grading" onClick={handleBulkGrading}>
                          일괄 채점 ({selectedIds.length}명)
                        </button>
                      </div>
                    )}
                  </section>
                </div>
              </>
            ) : (
              <div style={{ padding: '3rem', textAlign: 'center' }}>
                <h2>과제 관리 화면</h2>
                <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>과제 관리 기능을 준비 중입니다.</p>
              </div>
            )}
          </>
        )}
      </main>

      {/* --- 일괄 채점 워크플로우 모달 (NeoStudio2Lite 확인) --- */}
      {isBulkModalOpen && (
        <div className="modal-overlay">
          <div className="modal-container" style={{ width: '800px', height: 'auto', minHeight: '400px', padding: '2rem' }}>
            <button className="btn-modal-close" onClick={() => setIsBulkModalOpen(false)}>×</button>
            <h2 style={{ textAlign: 'center', fontSize: '1.5rem', marginBottom: '2rem' }}>펜 데이터 동기화</h2>

            {bulkStep === 'checking' && (
              <div style={{ textAlign: 'center', padding: '2rem 0' }}>
                <div className="loading-spinner" style={{ margin: '0 auto 2rem' }}></div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>NeoStudio2Lite 설치 여부를 확인하는 중입니다.</h3>
                <p style={{ color: '#8A94A1' }}>잠시만 기다려 주세요.</p>
              </div>
            )}

            {bulkStep === 'not_installed' && (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: '4rem', color: '#FF4D4D', marginBottom: '1.5rem' }}>⚠️</div>
                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>NeoStudio2Lite가 설치되어 있지 않습니다.</h3>
                <p style={{ color: '#8A94A1', marginBottom: '2rem' }}>펜 데이터 동기화를 위해 설치가 필요합니다.</p>
                <button className="btn-primary" style={{ padding: '0.8rem 2rem' }} onClick={() => setBulkStep('manual_install')}>
                  수동 설치 안내
                </button>
              </div>
            )}

            {bulkStep === 'manual_install' && (
              <div style={{ padding: '0.5rem' }}>
                <p style={{ textAlign: 'center', color: '#8A94A1', fontSize: '0.85rem', marginBottom: '2rem' }}>
                  자동 설치가 실패한 경우 아래 방법으로 수동 설치할 수 있습니다.
                </p>
                <div className="install-steps" style={{ marginBottom: '2rem' }}>
                  <div className="install-step" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="step-num" style={{ background: '#2A75F3', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>1</div>
                    <div>
                      <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>설치 파일 다운로드</div>
                      <p style={{ fontSize: '0.85rem', color: '#4E5968', marginBottom: '0.75rem' }}>NeoStudio2Lite 설치 파일을 다운로드합니다.</p>
                      <button 
                        className="btn-primary" 
                        style={{ background: '#2A75F3', fontSize: '0.85rem', padding: '0.6rem 1.25rem' }}
                        onClick={() => setIsNeoStudioInstalled(true)}
                      >
                        NeoStudio2Lite 설치 파일 다운로드 (약 100MB)
                      </button>
                    </div>
                  </div>
                  <div className="install-step" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="step-num" style={{ background: '#2A75F3', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>2</div>
                    <div>
                      <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>설치 파일 실행</div>
                      <p style={{ fontSize: '0.85rem', color: '#4E5968' }}>다운로드한 설치 파일을 실행합니다.</p>
                    </div>
                  </div>
                  <div className="install-step" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div className="step-num" style={{ background: '#2A75F3', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', flexShrink: 0 }}>3</div>
                    <div>
                      <div style={{ fontWeight: 800, marginBottom: '0.4rem' }}>설치 진행</div>
                      <p style={{ fontSize: '0.85rem', color: '#4E5968' }}>설치 마법사의 안내에 따라 설치를 진행합니다.</p>
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button className="btn-card-detail" style={{ width: '200px' }} onClick={() => { setIsBulkModalOpen(false); setIsNeoStudioInstalled(true); }}>닫기</button>
                </div>
              </div>
            )}

            {bulkStep === 'instruction' && (
              <div style={{ padding: '0.5rem' }}>
                <div style={{ background: '#EFF6FF', borderRadius: '12px', padding: '1.5rem', marginBottom: '2rem' }}>
                  <h3 style={{ color: '#1D4ED8', fontSize: '1rem', marginBottom: '1rem' }}>💡 일괄 채점 안내</h3>
                  <ul style={{ fontSize: '0.9rem', color: '#1E293B', lineHeight: '1.8' }}>
                    <li>• 선택하신 <strong>{selectedIds.length}명</strong>의 학생에 대해 AI 채점을 일괄 시작합니다.</li>
                    <li>• NeoSmartpen의 데이터가 NeoStudio2Lite를 통해 자동으로 서버에 전송됩니다.</li>
                    <li>• 채점 도중 브라우저를 닫지 마세요.</li>
                  </ul>
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
                  <button className="btn-card-detail" style={{ flex: 1 }} onClick={() => setIsBulkModalOpen(false)}>취소</button>
                  <button className="btn-primary" style={{ flex: 2 }} onClick={() => {
                    setBulkStep('final_bulk');
                  }}>채점 시작하기</button>
                </div>
              </div>
            )}

            {bulkStep === 'final_bulk' && (
              <div className="final-bulk-content" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                 <div className="cradle-guide-banner" style={{ background: '#4E5968', color: 'white', padding: '1rem 1.5rem', borderRadius: '12px', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontSize: '1.2rem' }}>💡</span>
                      <span style={{ fontWeight: 700 }}>크래들 이용 가이드</span>
                    </div>
                    <span>▼</span>
                 </div>

                  <div className="table-top-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
                    <div style={{ fontWeight: 800, fontSize: '0.9rem', display: 'flex', gap: '1rem' }}>
                       <span>연결된 펜 <span style={{ color: '#4E5968' }}>10개</span></span>
                       {bulkStatus === 'processing' && (
                         <>
                           <span style={{ marginLeft: '0.5rem' }}>채점 중 <span style={{ color: '#2A75F3' }}>4개</span></span>
                           <span>채점 완료 <span style={{ color: '#10B981' }}>1개</span></span>
                           <span>실패 <span style={{ color: '#FF4D4D' }}>5개</span></span>
                         </>
                       )}
                       {bulkStatus === 'completed' && (
                         <>
                           <span style={{ marginLeft: '0.5rem' }}>성공 <span style={{ color: '#10B981' }}>10개</span></span>
                           <span>실패 <span style={{ color: '#FF4D4D' }}>0개</span></span>
                         </>
                       )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                       <div style={{ display: 'flex', gap: '1rem', fontSize: '0.75rem', color: '#8A94A1' }}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', background: '#D1D5DB', borderRadius: '50%' }}></span> 크래들 연결전</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', background: '#9CA3AF', borderRadius: '50%' }}></span> 크래들 연결중...</span>
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', background: '#10B981', borderRadius: '50%' }}></span> 크래들 연결됨</span>
                       </div>
                       <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ color: '#10B981', fontSize: '0.8rem', fontWeight: 700 }}>● 크래들 연결됨</span>
                          <button className="btn-sync" style={{ padding: '4px 12px', fontSize: '0.75rem', borderRadius: '4px', background: '#F3F4F6', color: '#4E5968' }}>↺ 크래들 연결 새로고침</button>
                       </div>
                    </div>
                 </div>

                  {bulkStatus === 'completed' && (
                    <div style={{ background: '#10B981', color: 'white', padding: '0.6rem', borderRadius: '8px', textAlign: 'center', fontWeight: 700, fontSize: '0.85rem', marginBottom: '1rem', marginTop: '1rem' }}>
                       채점 완료: 모든 펜의 채점이 끝났습니다. 채점 목록에서 결과를 확인하세요.
                    </div>
                  )}
                 <div className="pen-list-table-wrapper" style={{ flex: 1, overflowY: 'auto', borderTop: '1px solid #1E2225' }}>
                    <table className="pen-list-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                       <thead>
                          <tr style={{ background: '#F1F3F5', borderBottom: '1px solid #dee2e6' }}>
                             <th style={{ padding: '12px 1rem', fontSize: '0.8rem', textAlign: 'left', fontWeight: 800 }}>펜 ID</th>
                             <th style={{ padding: '12px 1rem', fontSize: '0.8rem', textAlign: 'left', fontWeight: 800 }}>학생</th>
                             <th style={{ padding: '12px 1rem', fontSize: '0.8rem', textAlign: 'center', fontWeight: 800 }}>채점 진행</th>
                             <th style={{ padding: '12px 1rem', fontSize: '0.8rem', textAlign: 'center', fontWeight: 800 }}>데이터</th>
                             <th style={{ padding: '12px 1rem', fontSize: '0.8rem', textAlign: 'center', fontWeight: 800 }}>배터리</th>
                             <th style={{ padding: '12px 1rem', fontSize: '0.8rem', textAlign: 'center', fontWeight: 800 }}>펌웨어</th>
                          </tr>
                       </thead>
                       <tbody>
                          {penData.map((pen, idx) => {
                             const isNoData = pen.data === '데이터 없음';
                             const rowColor = isNoData ? '#ADB5BD' : (pen.isWarning ? '#FF4D4D' : '#4E5968');
                             
                             return (
                               <tr key={idx} style={{ borderBottom: '1px solid #f1f3f5', opacity: isNoData ? 0.6 : 1 }}>
                                  <td style={{ padding: '14px 1rem', fontSize: '0.85rem', color: rowColor, fontWeight: pen.isWarning ? 700 : 400 }}>{pen.id}</td>
                                  <td style={{ padding: '14px 1rem', fontSize: '0.85rem', color: rowColor, fontWeight: pen.isWarning ? 700 : 400 }}>{pen.student}</td>
                                  <td style={{ padding: '14px 1rem', fontSize: '0.85rem', textAlign: 'center' }}>
                                     {pen.status === 'AI 채점중' ? (
                                       <div style={{ position: 'relative', width: '220px', height: '24px', background: '#F3F4F6', borderRadius: '12px', overflow: 'hidden', margin: '0 auto' }}>
                                         <div style={{ position: 'absolute', top: 0, left: 0, width: `${pen.progress}%`, height: '100%', background: '#D1E3FF' }}></div>
                                         <span style={{ position: 'absolute', width: '100%', left: 0, top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', color: '#4E5968', fontWeight: 700 }}>AI 채점중</span>
                                       </div>
                                     ) : pen.status === 'AI 채점 완료' ? (
                                       <div style={{ width: '220px', background: '#D1E3FF', borderRadius: '12px', padding: '4px 0', fontSize: '0.75rem', color: '#2A75F3', fontWeight: 800, margin: '0 auto' }}>
                                          AI 채점 완료
                                       </div>
                                     ) : pen.status === '채점 실패' ? (
                                       <div style={{ width: '220px', background: '#FFF1F2', borderRadius: '12px', padding: '4px 0', fontSize: '0.75rem', color: '#FF4D4D', fontWeight: 800, margin: '0 auto' }}>
                                          채점 실패
                                       </div>
                                     ) : (
                                       <div style={{ background: '#F3F4F6', borderRadius: '15px', padding: '4px 20px', fontSize: '0.75rem', color: isNoData ? '#ADB5BD' : (pen.isWarning ? '#FF4D4D' : '#8A94A1'), display: 'inline-block', minWidth: '120px' }}>
                                          {pen.status}
                                       </div>
                                     )}
                                  </td>
                                  <td style={{ padding: '14px 1rem', fontSize: '0.85rem', textAlign: 'center', color: pen.data === '데이터 삭제' ? '#ADB5BD' : (isNoData ? '#ADB5BD' : '#2A75F3'), fontWeight: 700 }}>{pen.data}</td>
                                  <td style={{ padding: '14px 1rem', fontSize: '0.85rem', textAlign: 'center', color: rowColor }}>{pen.battery}</td>
                                  <td style={{ padding: '14px 1rem', fontSize: '0.85rem', textAlign: 'center' }}>
                                     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                                        <span style={{ fontSize: '0.8rem', color: isNoData ? '#ADB5BD' : (pen.needsUpdate ? '#FF4D4D' : '#8A94A1') }}>{pen.firmware}</span>
                                        {pen.needsUpdate && !pen.updating && !isNoData && (
                                           <button className="btn-update-mini" style={{ background: '#FF4D4D', color: 'white', border: 'none', borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer' }} onClick={startFirmwareUpdate}>업데이트</button>
                                        )}
                                        {pen.updating && (
                                           <div style={{ width: '60px', height: '6px', background: '#E5E7EB', borderRadius: '3px', overflow: 'hidden' }}>
                                              <div style={{ width: `${updatePercent}%`, background: '#2A75F3', height: '100%' }}></div>
                                           </div>
                                        )}
                                     </div>
                                  </td>
                               </tr>
                             )
                          })}
                       </tbody>
                    </table>
                 </div>

                  <div className="bulk-footer-btns" style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                     {bulkStatus === 'ready' ? (
                       <>
                         <button className={`btn-bulk-footer ${isUpdating ? 'updating' : ''}`} style={{ background: '#EBF2FF', color: '#2A75F3', border: 'none', padding: '0.8rem 1.5rem', borderRadius: '8px', fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                            {isUpdating ? '↺ 업데이트 진행 중...' : '↺ 펌웨어 일괄 업데이트'}
                         </button>
                         <button 
                           className={`btn-primary ${penData.some(p => p.needsUpdate) || isUpdating ? 'disabled' : ''}`} 
                           style={{ 
                             padding: '0.8rem 4rem', 
                             background: (penData.some(p => p.needsUpdate) || isUpdating) ? '#E9ECEF' : '#2A75F3', 
                             color: (penData.some(p => p.needsUpdate) || isUpdating) ? '#ADB5BD' : 'white', 
                             pointerEvents: (penData.some(p => p.needsUpdate) || isUpdating) ? 'none' : 'auto',
                             cursor: (penData.some(p => p.needsUpdate) || isUpdating) ? 'not-allowed' : 'pointer'
                           }}
                           onClick={startGrading}
                         >
                           일괄 채점 시작
                         </button>
                       </>
                     ) : (
                       <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem' }}>
                         <div style={{ position: 'relative' }}>
                           <div style={{ background: '#991B1B', color: 'white', width: '20px', height: '20px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 800, position: 'absolute', top: '-8px', left: '-8px', zIndex: 1 }}>{bulkStatus === 'completed' ? '8' : '7'}</div>
                         </div>
                         <button 
                           className="btn-card-detail" 
                           style={{ padding: '0.8rem 4rem', background: '#D1D5DB', border: 'none', borderRadius: '8px', color: '#4E5968', fontWeight: 800 }}
                           onClick={handleCloseProcessing}
                         >
                           닫기
                         </button>
                       </div>
                     )}
                  </div>
              </div>
            )}

            {/* 하단 정보 박스 (공통) */}
            {['checking', 'not_installed'].includes(bulkStep) && (
              <div style={{ background: '#F8F9FA', borderRadius: '16px', padding: '1.5rem', marginTop: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', marginRight: '2rem' }}>NeoStudio2Lite</div>
                <ul style={{ listStyle: 'none', fontSize: '0.85rem', color: '#4E5968' }}>
                  <li style={{ marginBottom: '0.4rem' }}>✓ USB 및 블루투스 펜 연결 지원</li>
                  <li style={{ marginBottom: '0.4rem' }}>✓ 크래들 일괄 채점 지원</li>
                  <li>✓ 자동으로 백그라운드에서 실행</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- 채점 상세 모달 (상세 레이아웃 반영) --- */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-container" onClick={e => e.stopPropagation()}>
            <button className="btn-modal-close" onClick={() => setIsModalOpen(false)}>×</button>
            <div className="step-banner">
              {selectedStudent?.status === '미채점' 
                ? 'STEP 1. 학생 답안 제출 대기 펜을 연결하고 제출된 데이터를 불러온 뒤 AI 채점을 시작하세요.'
                : 'AI 채점 결과를 확인하고 최종 피드백을 작성하여 검토를 완료하세요.'}
            </div>

            <div className="modal-content">
              <div className="grading-layout">
                {/* --- 1행 1열: 공통 영역 (이름, 탭, 펜 캡처) --- */}
                <div className="submission-area" style={{ background: 'white' }}>
                  <div className="modal-header-info" style={{ padding: '0 0 1.5rem 0' }}>
                    <div className="modal-student-name">
                      {selectedStudent?.name} <span style={{ fontSize: '0.9rem', color: '#8A94A1', marginLeft: '0.5rem' }}>{selectedStudent?.grade}</span>
                    </div>
                    {selectedStudent?.status === '미채점' && (
                      <button className="btn-sync">
                        <span className="dot"></span> 펜 데이터 동기화
                      </button>
                    )}
                  </div>

                  <div className="modal-question-tabs" style={{ padding: '0 0 1.5rem 0' }}>
                    {questions.map(q => (
                      <div 
                        key={q.id} 
                        className={`q-tab ${activeQuestion === q.id ? 'active' : ''}`}
                        onClick={() => setActiveQuestion(q.id)}
                      >
                        문항 {q.id} ({q.id}점)
                      </div>
                    ))}
                  </div>

                  <div className="submission-label">펜 캡처 원본</div>
                  <div className="pen-canvas-box" style={{ flex: 1, height: 'auto' }}>
                    <div className="pen-toolbar">
                      <div className="toolbar-btn">+</div>
                      <div className="toolbar-btn">-</div>
                      <div className="toolbar-btn">⤢</div>
                      <button className="toolbar-btn btn-playback">▶ 필기 재생</button>
                    </div>
                    <div className="page-indicator">1/1</div>
                    <div style={{ padding: '4rem', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                       <img src="/assets/images/sample_paper.png" alt="Scan Area" style={{ maxWidth: '100%', border: '1px solid #eee', opacity: 0.3, marginBottom: '1rem' }} />
                       <p style={{ color: '#8A94A1', fontSize: '0.9rem', fontWeight: 600 }}>
                         {selectedStudent?.status === '미채점' ? '학생의 펜 데이터를 호출하는 중입니다...' : '필기 데이터를 불러왔습니다.'}
                       </p>
                    </div>
                  </div>
                </div>

                {/* --- 1행 2열: 채점 결과 영역 --- */}
                <div className="grading-sidebar">
                  {selectedStudent?.status === '미채점' ? (
                    /* --- 미채점 단계 우측 UI --- */
                    <div className="grading-section">
                      <div className="section-title">채점 결과</div>
                      <div className="grading-result-box">
                        <div className="status-row">
                          <div className="status-item">
                            <span className="label">AI 채점 :</span>
                            <span className="value">미채점</span>
                          </div>
                          <div className="status-item">
                            <span className="label">교사 채점 :</span>
                            <span className="value">미채점</span>
                          </div>
                        </div>
                      </div>

                      <div className="scan-upload-container" style={{ marginTop: '1.5rem', border: 'none' }}>
                        <div className="scan-upload-header" onClick={() => setIsScanUploadOpen(!isScanUploadOpen)} style={{ padding: '0.5rem 0' }}>
                          <span className="scan-title" style={{ fontSize: '0.9rem' }}>🚨 스캔 업로드</span>
                          <div className={`arrow-toggle ${isScanUploadOpen ? 'open' : ''}`}>▼</div>
                        </div>
                        <p className="scan-desc" style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}>펜 데이터 유실 시, 스캔 답안지를 업로드하세요.</p>
                        {isScanUploadOpen && (
                          <div className="scan-upload-body" style={{ padding: '0' }}>
                            <div className="upload-dropzone">
                              <button className="btn-file-select" style={{ padding: '0.5rem 1rem' }}>↑ 파일 선택</button>
                              <span className="dropzone-text" style={{ fontSize: '0.8rem' }}>파일을 이곳에 업로드하세요.</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    /* --- 채점 확인 단계 우측 UI (Step ID 332 반영) --- */
                    <div className="grading-section" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                      <div className="section-title">채점 결과 및 확인</div>
                      <div className="grading-result-box" style={{ marginBottom: '1.5rem' }}>
                        <div className="status-row" style={{ marginTop: 0 }}>
                          <div className="status-item">
                            <span className="label">AI 채점 :</span>
                            <span className="value" style={{ color: 'var(--primary)' }}>노력 (3단계)</span>
                          </div>
                          <div className="status-item">
                            <span className="label">교사 채점 :</span>
                            <select className="select-box" style={{ padding: '2px 8px', fontSize: '0.8rem' }}>
                              <option>선택 안함</option>
                              <option>매우우수</option>
                              <option>우수</option>
                              <option>보통</option>
                              <option>노력</option>
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="re-grading-section">
                        <div style={{ fontWeight: 800, fontSize: '0.9rem', marginBottom: '0.5rem' }}>AI 재채점</div>
                        <p className="re-grading-desc">
                          AI 채점 결과를 다시 하고 싶을 때 사용합니다. 기존 채점 결과는 유지되며 새로운 결과로 업데이트 됩니다. (재채점은 1회만 가능합니다.)
                        </p>
                        <button className="btn-primary" style={{ background: '#EBF2FF', color: '#2A75F3', border: 'none', padding: '8px 16px', borderRadius: '8px', fontSize: '0.85rem' }}>AI 재채점 시작</button>
                      </div>

                      <div className="history-section" style={{ marginTop: '1.5rem' }}>
                        <div style={{ fontWeight: 800, fontSize: '0.8rem', color: '#1E2225', marginBottom: '1rem' }}>채점 히스토리</div>
                        <div className="history-list">
                          {gradingHistory.map(h => (
                            <div key={h.id} className="history-card">
                              <div className="history-card-header">
                                <span className="history-num">{h.label}</span>
                                <button 
                                  className={`btn-reflect-check ${reflectedHistoryId === h.id ? 'active' : ''}`}
                                  onClick={() => setReflectedHistoryId(h.id)}
                                >
                                  {reflectedHistoryId === h.id ? '✓ 반영됨' : '반영'}
                                </button>
                              </div>
                              <div className="history-body">
                                <div className="history-level">등급 레벨: <span style={{ color: '#F2994A' }}>{h.level}</span></div>
                                <div style={{ color: '#8A94A1', fontSize: '0.75rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                  {h.feedback}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* --- 2열 하단: 피드백 패널 (채점 확인 단계 전용) --- */}
              {selectedStudent?.status === '채점 확인' && (
                <div className="feedback-panels-wrapper">
                  <div className="ai-feedback-panel" style={{ borderRight: '1px solid rgba(255,255,255,0.1)' }}>
                    <div className="panel-header">
                      <span>AI 피드백 (참고용)</span>
                      <button 
                        className="btn-copy-mini"
                        onClick={() => setTeacherFinalFeedback(gradingHistory.find(h => h.id === reflectedHistoryId)?.feedback || '')}
                      >
                        문구 복사
                      </button>
                    </div>
                    <div className="feedback-content-area">
                      {gradingHistory.find(h => h.id === reflectedHistoryId)?.feedback}
                    </div>
                  </div>
                  <div className="teacher-feedback-panel">
                    <div className="panel-header">
                      <span>교사 최종 피드백 (교사 작성)</span>
                    </div>
                    <textarea 
                      className="teacher-input-box"
                      placeholder="AI 피드백을 참고하여 학생에게 전달할 최종 피드백을 입력하세요."
                      value={teacherFinalFeedback}
                      onChange={(e) => setTeacherFinalFeedback(e.target.value)}
                    ></textarea>
                    <div className="char-count">{teacherFinalFeedback.length}/1000</div>
                  </div>
                </div>
              )}
            </div>

            <footer className="modal-footer">
              {selectedStudent?.status === '미채점' ? (
                <button className="btn-invalid" onClick={() => { if(window.confirm('이 학생의 제출을 무효 처리하시겠습니까?')) setIsModalOpen(false); }}>
                  무효처리
                </button>
              ) : (
                <div></div> /* 좌측 여백 유지를 위한 빈 div */
              )}
              <div className="footer-btn-group">
                <button className="btn-nav">&lt; 이전 학생</button>
                <button className="btn-nav active">다음 학생 &gt;</button>
                {selectedStudent?.status === '미채점' ? (
                  <button className="btn-primary" style={{ padding: '0.6rem 2.5rem', fontWeight: 800 }}>AI 채점 시작</button>
                ) : (
                  <button className="btn-primary" style={{ padding: '0.6rem 2.5rem', fontWeight: 800, background: '#2A75F3' }}>검토 완료</button>
                )}
              </div>
            </footer>
          </div>
        </div>
      )}

      {/* --- 펜 펌웨어 업데이트 모달 --- */}
      {isFirmwareModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 10003 }}>
          <div className="modal-container" style={{ width: '800px', height: '600px', padding: '2rem', display: 'flex', flexDirection: 'column' }}>
            <button className="btn-modal-close" onClick={() => setIsFirmwareModalOpen(false)}>×</button>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>펜 펌웨어 업데이트 명단</h2>
            <p style={{ color: '#8A94A1', fontSize: '0.9rem', marginBottom: '2rem' }}>현재 연결된 펜의 펌웨어 상태를 확인하고 일괄 업데이트를 진행할 수 있습니다.</p>

            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '12px', marginBottom: '1.5rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: '#F1F3F5', zIndex: 1 }}>
                  <tr>
                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>No.</th>
                    <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>펜 MAC 주소</th>
                    <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>배터리</th>
                    <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>펌웨어 버전</th>
                    <th style={{ padding: '12px', textAlign: 'center', borderBottom: '1px solid var(--border)' }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsPenData.map((pen, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f3f5' }}>
                      <td style={{ padding: '10px 12px', color: '#8A94A1' }}>{idx + 1}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#4E5968' }}>{pen.mac}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{pen.battery}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>{pen.firmware}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {pen.needsUpdate ? (
                          <span style={{ color: '#FF4D4D', fontWeight: 800 }}>업데이트 필요</span>
                        ) : (
                          <span style={{ color: '#10B981', fontWeight: 700 }}>최신</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
              <button 
                className="btn-card-detail" 
                style={{ width: '150px' }}
                onClick={() => setIsFirmwareModalOpen(false)}
              >
                닫기
              </button>
              {settingsPenData.some(p => p.needsUpdate) && (
                <button 
                  className="btn-primary" 
                  style={{ background: '#FF4D4D', padding: '0.8rem 2rem' }}
                  onClick={() => {
                    alert('일괄 업데이트를 시작합니다.');
                    setIsFirmwareModalOpen(false);
                  }}
                >
                  일괄 업데이트 시작
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- 펜 초기화 확인 모달 --- */}
      {isResetModalOpen && (
        <div className="modal-overlay" style={{ zIndex: 10002 }}>
          <div className="modal-container" style={{ width: '440px', height: 'auto', padding: '2rem', textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '1rem' }}>기기 초기화 확인</h3>
            <p style={{ fontSize: '0.95rem', color: '#4E5968', lineHeight: '1.6', marginBottom: '2rem' }}>
              현재 <strong style={{ color: 'var(--primary)' }}>{settingsPenData.length}개</strong>의 펜이 연결되어 있습니다.<br />
              연결된 펜의 모든 데이터를 초기화하시겠습니까?<br />
              <span style={{ color: '#EF4444', fontWeight: 700 }}>초기화 후 삭제된 데이터는 되돌릴 수 없습니다.</span>
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                className="btn-card-detail" 
                style={{ flex: 1, padding: '0.8rem' }}
                onClick={() => setIsResetModalOpen(false)}
              >
                취소
              </button>
              <button 
                className="btn-primary" 
                style={{ flex: 1, padding: '0.8rem', background: '#EF4444' }}
                onClick={() => {
                  alert('모든 펜의 데이터가 초기화되었습니다.');
                  setIsResetModalOpen(false);
                }}
              >
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 채점 종료 확인 모달 --- */}
      {isConfirmCloseOpen && (
        <div className="modal-overlay" style={{ zIndex: 10001 }}>
          <div className="modal-container" style={{ width: '480px', height: 'auto', padding: '2.5rem', textAlign: 'center' }}>
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: '1.5rem' }}>
              <div style={{ background: '#991B1B', color: 'white', width: '24px', height: '24px', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, position: 'absolute', top: '-10px', left: '-25px' }}>7</div>
              <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 24 24' fill='none' stroke='%231E2225' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'%3E%3C/path%3E%3Cpolyline points='16 17 21 12 16 7'%3E%3C/polyline%3E%3Cline x1='21' y1='12' x2='9' y2='12'%3E%3C/line%3E%3C/svg%3E" alt="Exit" style={{ width: '64px', height: '64px' }} />
            </div>
            
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1E2225', lineHeight: '1.6', marginBottom: '2rem' }}>
              페이지를 벗어나도 AI 채점은 멈추지 않습니다.<br />
              20분 이내로 채점이 완료 예정입니다.
            </p>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button 
                className="btn-card-detail" 
                style={{ flex: 1, padding: '1rem', background: '#D1E3FF', color: '#1E2225', border: 'none' }}
                onClick={() => setIsConfirmCloseOpen(false)}
              >
                계속 채점하기
              </button>
              <button 
                className="btn-primary" 
                style={{ flex: 1, padding: '1rem', background: '#EF4444' }}
                onClick={proceedToBackground}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 백그라운드 채점 FAB --- */}
      {showFAB && (
        <div 
          className="grading-fab"
          style={{
            position: 'fixed',
            bottom: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'white',
            borderRadius: '50px',
            padding: '1rem 2rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            cursor: 'pointer',
            border: '2px solid #2A75F3',
            transition: 'all 0.3s ease'
          }}
          title="클릭하여 상세정보 보기"
          onClick={() => {
            setIsBulkModalOpen(true);
            setBulkStep('final_bulk');
            setShowFAB(false);
          }}
        >
          <style>
            {`
              @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
              }
            `}
          </style>
          <div className="fab-spinner" style={{ 
            width: '24px', 
            height: '24px', 
            border: '3px solid #EBF2FF', 
            borderTopColor: '#2A75F3', 
            borderRadius: '50%',
            animation: isGradingFinished ? 'none' : 'spin 1s linear infinite',
            background: isGradingFinished ? '#10B981' : 'transparent',
            borderColor: isGradingFinished ? '#10B981' : '',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          }}>
            {isGradingFinished && <span style={{ color: 'white', fontSize: '12px', fontWeight: 800 }}>✓</span>}
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1E2225' }}>
              {isGradingFinished ? '채점이 완료되었습니다.' : 'AI 가 채점하고 있어요.'}
            </div>
            {!isGradingFinished && (
              <div style={{ fontSize: '0.75rem', color: '#8A94A1' }}>잠시만 기다려 주세요.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
