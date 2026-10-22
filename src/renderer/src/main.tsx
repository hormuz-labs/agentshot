import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { startCrashReports } from './lib/crash'
import { startTheme } from './lib/theme'
import './styles.css'

void startCrashReports()
startTheme()
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
