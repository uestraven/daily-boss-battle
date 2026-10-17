import React from 'react';
import {createRoot} from 'react-dom/client';
import DailyBattle from './DailyBattle.js';
import {registerServiceWorker} from './register-sw.js';

import './dbb-portrait.css';
import './retro-command-menu.css';
import './retro-theme.css';
import './style.css';
import './retro-windows.css';
import './retro-battle-stage.css';
import './retro-sprite-assets.css';

const target = document.getElementById('root');

if (!target) throw new Error('Missing app root');
createRoot(target).render(<React.StrictMode><DailyBattle /></React.StrictMode>);

registerServiceWorker();
