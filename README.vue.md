# PromptMe AI - Vue.js + TypeScript

A professional teleprompter application built with Vue.js 3 and TypeScript.

## Project Structure

```
promptme-ai/
├── src/
│   ├── assets/
│   │   └── styles/
│   │       └── global.css          # Global styles
│   ├── components/
│   │   ├── TeleprompterControls.vue   # Control panel component
│   │   └── TeleprompterDisplay.vue    # Display/editor component
│   ├── composables/
│   │   └── useTeleprompter.ts      # Teleprompter logic composable
│   ├── types/
│   │   └── teleprompter.ts         # TypeScript type definitions
│   ├── App.vue                     # Main app component
│   └── main.ts                     # Application entry point
├── index.html                      # HTML entry point
├── package.json                    # Dependencies and scripts
├── tsconfig.json                   # TypeScript configuration
├── vite.config.ts                  # Vite configuration
└── vite-env.d.ts                   # Vite type declarations
```

## Features

- **Component-based architecture**: Modular Vue components for maintainability
- **TypeScript**: Full type safety throughout the application
- **Composables**: Reusable logic with Vue's Composition API
- **Reactive state management**: Using Vue's reactivity system
- **Scoped styling**: Component-level CSS with scoped styles
- **Type definitions**: Clear interfaces for all data structures

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

4. Preview production build:
```bash
npm run preview
```

5. Type check:
```bash
npm run type-check
```

## Development

### Adding New Features

1. **Add types**: Define interfaces in `src/types/teleprompter.ts`
2. **Update composable**: Add logic to `src/composables/useTeleprompter.ts`
3. **Update components**: Modify Vue components as needed
4. **Add styles**: Use scoped styles in components or global styles in `src/assets/styles/`

### Key Files

- **[src/composables/useTeleprompter.ts](src/composables/useTeleprompter.ts)**: Contains all teleprompter logic (animation, state management)
- **[src/components/TeleprompterControls.vue](src/components/TeleprompterControls.vue)**: Control panel UI
- **[src/components/TeleprompterDisplay.vue](src/components/TeleprompterDisplay.vue)**: Text editor and display
- **[src/App.vue](src/App.vue)**: Main component that ties everything together

## Technology Stack

- **Vue.js 3**: Progressive JavaScript framework
- **TypeScript**: Type-safe JavaScript
- **Vite**: Fast build tool and dev server
- **Composition API**: Modern Vue API for better code organization

## Browser Support

Modern browsers with ES2020 support (Chrome, Firefox, Safari, Edge).
