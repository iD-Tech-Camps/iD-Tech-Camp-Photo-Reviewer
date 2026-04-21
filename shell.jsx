// Shell: sidebar + page header

function Sidebar({ current, onNav, isAdmin, pendingCount = 10 }) {
  const userItems = [
    { id: 'review',      label: 'Review',             icon: 'review', badge: pendingCount },
    { id: 'leaderboard', label: 'Stats & Leaderboard',icon: 'trophy' },
    { id: 'profile',     label: 'My profile',         icon: 'user' },
    { id: 'guide',       label: 'Guide & examples',   icon: 'book' },
  ];
  const adminItems = [
    { id: 'admin-overview',   label: 'Overview',       icon: 'bolt' },
    { id: 'admin-assignment', label: 'Assignment',     icon: 'sliders' },
    { id: 'admin-points',     label: 'Points & rules', icon: 'medal' },
    { id: 'admin-examples',   label: 'Example library',icon: 'image' },
    { id: 'admin-users',      label: 'Users',          icon: 'users' },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><span>Ƭ</span></div>
        <div>
          <div className="brand-name">Treeline</div>
          <div className="brand-tag">Photo Review · iD Tech</div>
        </div>
      </div>

      <div className="nav-section">Reviewer</div>
      {userItems.map(it => (
        <button
          key={it.id}
          className={'nav-item' + (current === it.id ? ' active' : '')}
          onClick={() => onNav(it.id)}
        >
          <Icon name={it.icon} />
          <span>{it.label}</span>
          {it.badge ? <span className="badge">{it.badge}</span> : null}
        </button>
      ))}

      <div className="nav-section">
        Admin {!isAdmin && <span style={{ opacity: 0.6 }}>(preview)</span>}
      </div>
      {adminItems.map(it => (
        <button
          key={it.id}
          className={'nav-item' + (current === it.id ? ' active' : '')}
          onClick={() => onNav(it.id)}
          style={{ opacity: isAdmin ? 1 : 0.75 }}
        >
          <Icon name={it.icon} />
          <span>{it.label}</span>
        </button>
      ))}

      <div className="sidebar-footer">
        <div className="avatar">RT</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>Riley Turner</div>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
            Programs · Reviewer
          </div>
        </div>
        <button className="nav-item" style={{ width: 28, height: 28, padding: 0, justifyContent: 'center' }}
          title="Settings">
          <Icon name="gear" size={14} />
        </button>
      </div>
    </aside>
  );
}

function PageHeader({ eyebrow, title, sub, children }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title" dangerouslySetInnerHTML={{ __html: title }} />
        {sub && <div className="page-sub">{sub}</div>}
      </div>
      {children && <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>{children}</div>}
    </div>
  );
}

// Confetti burst from a point
function fireConfetti(x = window.innerWidth / 2, y = window.innerHeight / 3, count = 80) {
  const colors = [
    'oklch(0.72 0.17 55)',
    'oklch(0.58 0.11 230)',
    'oklch(0.55 0.12 155)',
    'oklch(0.62 0.16 25)',
    'oklch(0.75 0.14 95)',
  ];
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.background = colors[i % colors.length];
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    const angle = Math.random() * Math.PI * 2;
    const velocity = 200 + Math.random() * 300;
    const dx = Math.cos(angle) * velocity;
    const dy = Math.sin(angle) * velocity - 150;
    const rot = Math.random() * 720 - 360;
    const dur = 1400 + Math.random() * 800;
    el.animate([
      { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy + 500}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: dur, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)' });
    document.body.appendChild(el);
    setTimeout(() => el.remove(), dur);
  }
}

// Toast — stack of transient notifications in bottom-right.
// show(msg, icon) for plain info; showPoints(amount, label) for point gains.
function useToast() {
  const [toasts, setToasts] = React.useState([]);
  const push = (t) => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { ...t, id }]);
    setTimeout(() => setToasts(ts => ts.filter(x => x.id !== id)), 2400);
  };
  const show = (msg, icon) => push({ kind: 'info', msg, icon });
  const showPoints = (amount, label = 'points') =>
    push({ kind: 'points', amount, label });

  const node = (
    <div className="toast-stack">
      {toasts.map(t => {
        if (t.kind === 'points') {
          return (
            <div key={t.id} className="toast toast-points">
              <Icon name="stars" size={20} />
              <div>
                <div className="toast-amount">+{t.amount}</div>
                <div className="toast-label">{t.label}</div>
              </div>
            </div>
          );
        }
        return (
          <div key={t.id} className={"toast" + (t.tone ? " toast-" + t.tone : "")}>
            {t.icon && <Icon name={t.icon} size={15} />}
            <span>{t.msg}</span>
          </div>
        );
      })}
    </div>
  );
  return { show, showPoints, node };
}

Object.assign(window, { Sidebar, PageHeader, fireConfetti, useToast });
