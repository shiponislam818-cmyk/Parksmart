import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3, Building2, Car, CircleDollarSign, ClipboardList, History, KeyRound, LayoutDashboard, LogOut, Map, Menu,
  ParkingSquare, ScanLine, Ticket, Users, CalendarClock, BadgeCheck,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { ROLE_LABELS } from '../lib/format';
import { disconnectSocket } from '../lib/socket';

const NAV = {
  admin: [
    { section: 'Overview' },
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/reports', label: 'Reports', icon: BarChart3 },
    { section: 'Operations' },
    { to: '/gate', label: 'Gate counter', icon: ScanLine },
    { to: '/map', label: 'Live slot map', icon: Map },
    { to: '/sessions', label: 'Parking sessions', icon: Ticket },
    { section: 'Setup' },
    { to: '/admin/facilities', label: 'Facilities & slots', icon: Building2 },
    { to: '/admin/rates', label: 'Rates & policies', icon: CircleDollarSign },
    { to: '/admin/staff', label: 'Staff & users', icon: Users },
    { to: '/admin/audit', label: 'Audit log', icon: ClipboardList },
  ],
  operator: [
    { section: 'Gate' },
    { to: '/gate', label: 'Gate counter', icon: ScanLine },
    { to: '/map', label: 'Live slot map', icon: Map },
    { to: '/sessions', label: 'Parking sessions', icon: Ticket },
  ],
  driver: [
    { section: 'Driver portal' },
    { to: '/driver', label: 'Home', icon: ParkingSquare, end: true },
    { to: '/driver/reserve', label: 'Reservations', icon: CalendarClock },
    { to: '/driver/passes', label: 'Monthly passes', icon: BadgeCheck },
    { to: '/driver/vehicles', label: 'My vehicles', icon: Car },
    { to: '/driver/history', label: 'History & receipts', icon: History },
  ],
};

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">P</div>
      <div>
        <div className="brand-name">ParkSmart</div>
        <div className="brand-sub">Smart parking management</div>
      </div>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setOpen(false), [loc.pathname]);
  const items = NAV[user.role] || [];

  const doLogout = async () => {
    disconnectSocket();
    await logout();
  };

  return (
    <div className="shell">
      <div className={`drawer-backdrop ${open ? 'show' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-inner glass">
          <Brand />
          <nav className="stack" style={{ gap: 2 }}>
            {items.map((it) => (it.section
              ? <div key={it.section} className="nav-section">{it.section}</div>
              : (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <it.icon size={18} /> {it.label}
                </NavLink>
              )))}
          </nav>
          <div className="sidebar-foot">
            <div className="user-chip">
              <div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div>
              <div className="who"><b>{user.name}</b><span>{ROLE_LABELS[user.role]}</span></div>
            </div>
            <NavLink to="/account" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><KeyRound size={18} /> Account & password</NavLink>
            <button type="button" className="btn btn-block" onClick={doLogout}><LogOut size={16} /> <span>Log out</span></button>
          </div>
        </div>
      </aside>
      <div style={{ minWidth: 0 }}>
        <header className="topbar glass">
          <button type="button" className="btn btn-icon" aria-label="Open menu" onClick={() => setOpen(true)}><Menu size={18} /></button>
          <Brand />
          <div className="avatar" title={user.name}>{user.name.slice(0, 1).toUpperCase()}</div>
        </header>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

