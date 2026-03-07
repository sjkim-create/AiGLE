import React from 'react';

const Sidebar = ({
    activeMenu,
    setActiveMenu,
    activeSubMenu,
    setActiveSubMenu,
    isSettingsMode,
    setIsSettingsMode,
    activeSettingsMenu,
    setActiveSettingsMenu,
    isProfileDropdownOpen,
    setIsProfileDropdownOpen
}) => {
    return (
        <aside className="main-sidebar">
            <div
                className="logo-container"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                    setIsSettingsMode(false);
                    setActiveMenu('과제 및 채점관리');
                    setActiveSubMenu('채점 관리');
                }}
            >
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
                        <div
                            className={`nav-item ${activeMenu === 'Prompt Studio' ? 'active' : ''}`}
                            onClick={() => {
                                setActiveMenu('Prompt Studio');
                                if (activeMenu !== 'Prompt Studio') setActiveSubMenu('Prompt Studio');
                            }}
                        >
                            ⚗️ Prompt Studio <span className="arrow">▼</span>
                        </div>

                        {activeMenu === 'Prompt Studio' && (
                            <div className="nav-sub-menu">
                                <div
                                    className={`nav-sub-item ${activeSubMenu === 'Prompt Studio' ? 'active' : ''}`}
                                    onClick={() => setActiveSubMenu('Prompt Studio')}
                                >
                                    ⊙ Prompt Studio
                                </div>
                                <div
                                    className={`nav-sub-item ${activeSubMenu === 'Prompt 아카이브' ? 'active' : ''}`}
                                    onClick={() => setActiveSubMenu('Prompt 아카이브')}
                                >
                                    ⊙ Prompt 아카이브
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <>
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
    );
};

export default Sidebar;
