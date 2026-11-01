import React from 'react';
import {createRoot} from 'react-dom/client';
import RuntimeBoundary from './backend/RuntimeBoundary';
import './style.css';
import './live.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><RuntimeBoundary/></React.StrictMode>);
