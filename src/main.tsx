import {createRoot} from 'react-dom/client';
import {GlazePortalProvider} from '@/lib/glaze/portal';
import '@/index.css';
import '@/components/glaze/styles.css';
import {App} from '@/app';

createRoot(document.getElementById('root')!).render(<GlazePortalProvider><App/></GlazePortalProvider>);
