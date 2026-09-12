import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: { react },
    settings: { react: { version: 'detect' } },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      // JSX에 쓴 이름을 "사용됨"으로 표시한다. 이게 없으면 <Icon /> 로만 쓰이는
      // 임포트가 전부 미사용으로 잡혀서, 대문자 이름을 통째로 예외 처리해야 했다.
      'react/jsx-uses-vars': 'error',
      // 임포트하지 않은 컴포넌트를 JSX에 쓰면 잡는다.
      // 기본 no-undef는 JSX 이름을 참조로 보지 않아 이 실수를 통과시킨다.
      // 실제로 파일을 나누는 작업에서 아이콘 임포트 누락 세 건이 린트와 빌드를
      // 모두 통과하고 브라우저 테스트에서야 드러났다.
      'react/jsx-no-undef': 'error',
      'no-unused-vars': 'error',
      // 렌더 중에 아직 선언되지 않은 상태를 읽으면 화면 전체가 흰 화면이 된다.
      // 테스트로는 안 잡히는 종류의 사고라 린트에서 막는다.
      'no-use-before-define': ['error', {
        functions: false,
        classes: false,
        variables: true,
        allowNamedExports: true,
      }],
    },
  },
])
