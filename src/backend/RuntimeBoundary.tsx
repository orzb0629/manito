import { lazy, Suspense } from 'react';
import { resolveClientConfig } from './config';
const DemoApp = lazy(() => import('../App'));
const LiveApp = lazy(() => import('../LiveApp'));
const config = resolveClientConfig(import.meta.env);

export default function RuntimeBoundary() {
 if (config.mode === 'demo') return <Suspense fallback={null}><DemoApp/></Suspense>;
 if(config.mode==='supabase')return <Suspense fallback={<p className="notice" role="status">비밀의 마니또를 불러오고 있어요.</p>}><LiveApp/></Suspense>;
 return <div className="content"><section className="panel empty" role="status"><h1>비밀의 마니또</h1><p>{config.message}</p></section></div>;
}
