import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, homeFor } from './lib/auth';
import Ambient from './components/Ambient';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import Login from './pages/Login';
import Register from './pages/Register';
import GuestTicket from './pages/GuestTicket';
import Gate from './pages/Gate';
import SlotMap from './pages/SlotMap';
import Sessions from './pages/Sessions';
import Dashboard from './pages/admin/Dashboard';
import Facilities from './pages/admin/Facilities';
import Rates from './pages/admin/Rates';
import Staff from './pages/admin/Staff';
import Reports from './pages/admin/Reports';
import AuditLog from './pages/admin/AuditLog';
import DriverHome from './pages/driver/DriverHome';
import Reserve from './pages/driver/Reserve';
import Passes from './pages/driver/Passes';
import Vehicles from './pages/driver/Vehicles';
import HistoryPage from './pages/driver/History';
import Account from './pages/Account';
import ReceiptPage from './pages/ReceiptPage';
import TicketPage from './pages/TicketPage';
import PayPage from './pages/PayPage';
import NotFound from './pages/NotFound';

/** FR-AUTH-05: screen-level role guard (the API enforces the same matrix server-side). */
function RequireRole({ roles, children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="center-page"><Loading /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="center-page"><Loading /></div>;
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

const STAFF = ['admin', 'operator'];

export default function App() {
  return (
    <>
      <Ambient />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/t/:code" element={<GuestTicket />} />

        <Route element={<RequireRole><Layout /></RequireRole>}>
          <Route path="/gate" element={<RequireRole roles={STAFF}><Gate /></RequireRole>} />
          <Route path="/map" element={<RequireRole roles={STAFF}><SlotMap /></RequireRole>} />
          <Route path="/sessions" element={<RequireRole roles={STAFF}><Sessions /></RequireRole>} />
          <Route path="/ticket/:id" element={<RequireRole roles={STAFF}><TicketPage /></RequireRole>} />

          <Route path="/admin" element={<RequireRole roles={['admin']}><Dashboard /></RequireRole>} />
          <Route path="/admin/facilities" element={<RequireRole roles={['admin']}><Facilities /></RequireRole>} />
          <Route path="/admin/rates" element={<RequireRole roles={['admin']}><Rates /></RequireRole>} />
          <Route path="/admin/staff" element={<RequireRole roles={['admin']}><Staff /></RequireRole>} />
          <Route path="/admin/reports" element={<RequireRole roles={['admin']}><Reports /></RequireRole>} />
          <Route path="/admin/audit" element={<RequireRole roles={['admin']}><AuditLog /></RequireRole>} />

          <Route path="/driver" element={<RequireRole roles={['driver']}><DriverHome /></RequireRole>} />
          <Route path="/driver/reserve" element={<RequireRole roles={['driver']}><Reserve /></RequireRole>} />
          <Route path="/driver/passes" element={<RequireRole roles={['driver']}><Passes /></RequireRole>} />
          <Route path="/driver/vehicles" element={<RequireRole roles={['driver']}><Vehicles /></RequireRole>} />
          <Route path="/driver/history" element={<RequireRole roles={['driver']}><HistoryPage /></RequireRole>} />

          <Route path="/account" element={<Account />} />
          <Route path="/receipt/:id" element={<ReceiptPage />} />
          <Route path="/pay/:id" element={<PayPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}
