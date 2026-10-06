import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { AppDialogHost } from './components/ui/AppDialog'
import { initRipple } from './lib/ripple'

// Once, at the document, rather than inside the tree: the press ripple listens
// for every control in the app including the ones portalled to <body>, and
// nothing in React has to know it exists.
initRipple()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    {/* The app's own confirm/alert card, beside the app rather than inside
        it, so the login screen and every shell share the one host. */}
    <AppDialogHost />
  </StrictMode>,
)
