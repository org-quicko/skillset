import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { TooltipProvider } from './components/ui/tooltip'
import { queryClient } from './lib/query-client'
import { RouterProvider } from './lib/router'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </RouterProvider>
    </QueryClientProvider>
  </StrictMode>,
)
