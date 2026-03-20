# AiGLE Prototype 메뉴별 개발 파일 매핑 정의 문서

## 📌 1. 개요 및 구조 설명
현재 프로젝트(`Aigle2`)는 라우터(React Router 등) 기반의 라우팅 대신 최상단 컨테이너 컴포넌트 내부에서 `useState` 상태값(`activeMenu`, `activeSubMenu`, `isSettingsMode` 등)을 활용해 조건부 렌더링을 수행하는 프로토타입 형태입니다.

- **메인 진입점(Entry Point):** `src/main.jsx`
- **전체 레이아웃 및 화면 제어:** `src/Setting.jsx` (실제 구동 화면)
  - *과거 작업이 남아 있는 파일로 `src/App.jsx`도 유사한 내용이 포함되어 있으나 `main.jsx`에서는 `Setting.jsx`를 호출하고 있습니다.*
- **사이드바(네비게이션):** `src/Sidebar.jsx`
- **전역 스타일:** `src/index.css`

---

## 📂 2. 메뉴별 파일명 및 경로 (채점관리 중심)

요청하신 **채점관리** 및 그 외 주요 사이드바 메뉴 탭들의 파일 매핑은 아래와 같습니다.

| 메인 메뉴 | 서브 메뉴 및 뷰 | 개발 파일(컴포넌트) 경로 | 비고 |
|:---|:---|:---|:---|
| **과제 및 채점관리** | **채점 관리** ⭐ | `src/Setting.jsx` | **현재 채점관리 뷰(학생 목록, 테이블, 모달 창, 일괄채점 플로팅버튼, NeoStudio 크래들 등) 코드는 별도 파일로 분리되지 않고 `Setting.jsx` 내부에 통째로 기입되어 있습니다.** |
| | 과제 관리 | `src/Setting.jsx` | "준비 중입니다" 문구 출력 처리 |
| **대시보드** | - | `src/Setting.jsx` | "준비 중입니다" 문구 출력 처리 |
| **학생** | - | `src/Setting.jsx` | "준비 중입니다" 문구 출력 처리 |
| **게시판** | - | `src/Setting.jsx` | "준비 중입니다" 문구 출력 처리 |
| **Prompt Studio** | **Prompt Studio** | `src/PromptStudio.jsx` | AI 채점 및 프롬프트 에디터 단독 컴포넌트 분리 (`SmartGrading.jsx`가 이전에 쓰인 이력 존재) |
| | **Prompt 아카이브** | `src/PromptArchive.jsx` | 단독 컴포넌트 분리 |
| | *(아카이브 상세 리포트)* | `src/AnalysisReport.jsx` | 아카이브 목록에서 뷰 전환 시 표시 |
| **환경설정/프로필** | **환경설정** | `src/Setting.jsx` | 기기 펌웨어 관리, 커넥트 다운로드 등 개발 |
| | 내 정보 / 고객센터 | `src/Setting.jsx` | "준비 중입니다" 문구 출력 처리 |

---

## 🎯 3. [채점 관리] 핵심 파일 경로 요약

- **채점 관리 화면 경로**: `src/Setting.jsx`
  - *상세:* 현재 `Setting.jsx` 파일 내에서 `activeSubMenu === '채점 관리'` 일 경우 화면을 렌더링하는 영역에 과제 선택, 학생 리스트 UI, 일괄 펜 채점 워크플로우(크래들 연결 모달 등)가 100% 통합되어 작성되어 있습니다.

추후 유지보수 시나리오나 운영 단계로 넘어간다면, `src/Setting.jsx` 내에 길게 작성된 채점 관리 코드 라인들을 `src/pages/GradingManagement.jsx` 등의 별도 파일 구조로 컴포넌트를 분리하는 리팩토링이 필요해 보입니다.
