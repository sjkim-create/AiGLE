# AiGLE 프로토타입 배포 가이드

본 가이드는 Vite + React로 구성된 AiGLE 프로토타입의 배포 절차를 안내합니다.

---

## 1. 빌드 (Local Build)

배포 전, 소스 코드를 최적화된 정적 파일로 변환해야 합니다.

1. 터미널을 열고 프로젝트 루트 디렉토리로 이동합니다.
2. 아래 명령어를 실행합니다:
   ```bash
   npm run build
   ```
3. 실행이 완료되면 프로젝트 폴더 내에 `dist` 폴더가 생성됩니다. 이 폴더 안에 있는 파일들이 실제 서버에 업로드될 결과물입니다.

---

## 2. 추천 배포 방법

프로토타입 확인을 위해 가장 빠르고 간편한 방법은 **Vercel** 또는 **Netlify**를 사용하는 것입니다.

### A. Vercel 을 이용한 배포 (추천)

1. [Vercel](https://vercel.com/) 사이트에 가입합니다.
2. `Add New` -> `Project`를 클릭합니다.
3. GitHub 저장소를 연결하거나, 로컬에서 [Vercel CLI](https://vercel.com/docs/cli)를 설치하여 바로 배포할 수 있습니다.
   - CLI 설치: `npm i -g vercel`
   - 배포 실행: `vercel` (프로젝트 폴더에서 실행)
4. 자동으로 프로젝트 타입을 **Vite**로 인식하여 배포됩니다.

### B. GitHub Pages 를 이용한 배포

1. `vite.config.js` 파일에 `base: '/저장소이름/'`을 추가해야 할 수 있습니다. (사용자 아이디 주소인 경우 생략 가능)
2. `npm install gh-pages --save-dev` 를 실행하여 배포 패키지를 설치합니다.
3. `package.json`의 `scripts`에 아래 내용을 추가합니다:
   ```json
   "predeploy": "npm run build",
   "deploy": "gh-pages -d dist"
   ```
4. `npm run deploy` 명령어로 배포를 실행합니다.

---

## 3. 서버 수동 업로드 (Traditional)

호스팅 서버(AWS S3, 카페24, 자체 서버 등)를 이미 가지고 계신 경우:

1. `npm run build`로 생성된 `dist` 폴더 내의 모든 파일을 서버의 웹 루트(`public_html` 등)로 업로드합니다.
2. `index.html`이 경로의 최상단에 위치하도록 합니다.

---

## 4. 주의 사항

- **경로 설정**: 배포 후 화면이 하얗게 나온다면 `index.html` 내의 리소스(CSS, JS) 경로가 절대 경로인지 상대 경로인지 확인하십시오. Vite는 기본적으로 절대 경로(`/`)를 사용하므로, 서브 디렉토리에 배포할 경우 `vite.config.js`의 `base` 설정을 수정해야 합니다.
- **환경 변수**: API 서버 주소가 있다면 `.env` 파일을 통해 배포용 서버 주소를 관리하는 것이 좋습니다.
