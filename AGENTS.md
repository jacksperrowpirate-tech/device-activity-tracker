# Repository Guidelines

## Project Structure & Module Organization

The root package is the TypeScript backend and CLI; its scripts use `src/`. The React frontend lives in `client/src/`: screens in `components/`, shared state in `providers/`, hooks in `hooks/`, and types in `types/`. Static assets are in `client/public/`. Docker files and `.env.example` are at the root.

## Build, Test, and Development Commands

- `npm install`: install root dependencies; its `postinstall` also installs `client/` dependencies.
- `npm run build`: compile backend TypeScript to `dist/` using `tsc`.
- `npm run start:server`: start the Signal API initialization and backend server.
- `npm run start:client`: start the React development server on port 3000 by default.
- `cd client && npm run build`: create a production frontend build.
- `cd client && CI=true npm test -- --watch=false`: run frontend tests once.
- `cp .env.example .env && docker compose up --build`: start the container stack; `docker compose down` stops it.

## Coding Style & Naming Conventions

Use TypeScript and keep strict type checking enabled. Follow each file's indentation (the UI uses both two and four spaces); avoid unrelated reformatting. Name React components and files in PascalCase, hooks with a `use` prefix, and tests `*.test.tsx`. The frontend uses Create React App's `react-app` ESLint configuration; no separate formatter or root lint command is configured.

## Testing Guidelines

Frontend tests use Jest, React Testing Library, and `@testing-library/jest-dom` through `client/src/setupTests.ts`. Add tests beside affected UI code and assert user-visible behavior. `client/src/App.test.tsx` is a starter test that may need replacement. There is no backend test script or coverage threshold; run relevant builds and frontend tests before a PR.

## Commit & Pull Request Guidelines

Recent commits use short imperative subjects, sometimes prefixed with `fix:` or `feat:`. Keep commits and PRs focused. Follow `CONTRIBUTING.md`: use a topic branch such as `feature/my-change`, and explain the change and motivation in the PR. Link a related issue when one exists, include screenshots for UI changes, and report the commands you ran.

## Security & Configuration

Never commit `.env`, authentication/session folders, or `data/` contents. Use `.env.example` for configuration shape only. This is a research proof of concept; obtain explicit consent before tracking any account, as described in the README.
