import { useState } from 'react';
// @ts-ignore
import CustomersTab from './CustomersTab';
import StatusTab from './StatusTab';

const TABS = [
  { id: 'customers', label: 'Customer' },
  { id: 'status', label: 'Status' },
] as const;

export default function App() {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('customers');
  return (
    <>
      <nav className="shell-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </nav>
      {/* Both tabs stay mounted so results survive switching tabs */}
      <div className="tab-customers" hidden={tab !== 'customers'}><CustomersTab /></div>
      <div className="tab-status" hidden={tab !== 'status'}><StatusTab /></div>
    </>
  );
}
