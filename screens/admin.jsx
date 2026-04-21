// Admin screens

function AdminOverview() {
  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="<em>Overview.</em>"
        sub="The whole operation at a glance."
      >
        <button className="btn btn-ghost"><Icon name="download" size={14} /> Export CSV</button>
        <button className="btn btn-primary"><Icon name="bolt" size={14} /> Start double-points</button>
      </PageHeader>

      <div className="page-body">
        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 20 }}>
          {[
            ['In queue',       '2,481', 'photos'],
            ['Reviewed today', '1,204', 'photos'],
            ['Avg time/photo', '22',    'sec'],
            ['Flag rate',      '4.7',   '%'],
            ['Active reviewers','31',   '/ 47'],
          ].map(([l, v, u]) => (
            <div key={l} className="card">
              <span className="stat-label">{l}</span>
              <div style={{
                fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 450,
                letterSpacing: '-0.02em', lineHeight: 1, marginTop: 6,
              }}>
                {v}<small style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-3)', marginLeft: 4, fontWeight: 'normal' }}>{u}</small>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
          {/* Queue by camp */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Queue depth by camp</h3>
              <span className="card-eyebrow">Live · from SmugMug</span>
            </div>
            {[
              ['Game Dev · Stanford', 412, 'sun'],
              ['Robotics · UCLA',     389, 'lake'],
              ['AI & ML · MIT',       521, 'moss'],
              ['Film · NYU',          298, 'rose'],
              ['Roblox · Caltech',    602, 'ink-2'],
              ['Creative · USC',      259, 'ink-3'],
            ].map(([camp, n, c]) => {
              const max = 602;
              return (
                <div key={camp} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color: 'var(--ink-2)' }}>{camp}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>{n} photos</span>
                  </div>
                  <div className="progress-track" style={{ height: 8 }}>
                    <div className="progress-fill" style={{ width: ((n/max)*100)+'%', background: `var(--${c})` }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Flagged feed */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Flagged for review</h3>
              <span className="pill pill-sun">14 open</span>
            </div>
            {[
              ['IMG_4612', 'Riley T.',   'Gesture unclear'],
              ['IMG_4590', 'Marcus W.',  'Could be hero shot?'],
              ['IMG_4588', 'Ana F.',     'Lighting borderline'],
              ['IMG_4571', 'Priya S.',   'Duplicate of 4570?'],
            ].map(([id, who, note]) => (
              <div key={id} style={{ padding: '10px 0', borderTop: '1px solid var(--rule)', fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{id}</span>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{who}</span>
                </div>
                <div style={{ color: 'var(--ink-3)', fontSize: 12 }}>{note}</div>
              </div>
            ))}
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 10 }}>
              Review all flags <Icon name="arrow-r" size={12} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function AdminAssignment() {
  const [strategy, setStrategy] = React.useState('roundrobin');
  const [batchSize, setBatchSize] = React.useState(10);
  const [reminderDays, setReminderDays] = React.useState(2);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Assignment"
        title="How photos <em>flow.</em>"
        sub="Control how the queue is sliced up across reviewers."
      >
        <button className="btn btn-ghost">Discard</button>
        <button className="btn btn-primary">Save changes</button>
      </PageHeader>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Assignment strategy</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[
                ['roundrobin', 'Round-robin',     'Each reviewer gets the next N in the queue.'],
                ['bycamp',     'By camp',         'Match reviewers to camps they know well.'],
                ['random',     'Random',          'Shuffled across the whole queue.'],
              ].map(([id, title, desc]) => (
                <button key={id}
                  onClick={() => setStrategy(id)}
                  style={{
                    padding: 14, borderRadius: 'var(--radius-sm)',
                    border: strategy === id ? '2px solid var(--ink)' : '1px solid var(--rule-2)',
                    background: strategy === id ? 'var(--paper-3)' : 'var(--paper)',
                    textAlign: 'left', cursor: 'pointer',
                  }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.4 }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Batch settings</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="label">Photos per batch</label>
                <input type="range" min="5" max="25" value={batchSize}
                  onChange={(e) => setBatchSize(+e.target.value)}
                  style={{ width: '100%' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                  <span>5</span>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, color: 'var(--ink)' }}>{batchSize}</span>
                  <span>25</span>
                </div>
              </div>
              <div>
                <label className="label">Auto-reassign after</label>
                <select className="select" defaultValue="30">
                  <option value="15">15 minutes of inactivity</option>
                  <option value="30">30 minutes of inactivity</option>
                  <option value="60">1 hour of inactivity</option>
                </select>
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 6 }}>Reminders</h3>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 14 }}>
              Nudge inactive reviewers via email + in-app.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <label className="label">Remind after inactivity</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input type="range" min="1" max="14" value={reminderDays}
                    onChange={(e) => setReminderDays(+e.target.value)}
                    style={{ flex: 1 }} />
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, minWidth: 64 }}>
                    {reminderDays}d
                  </span>
                </div>
              </div>
              <div>
                <label className="label">Channels</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button className="tag-chip active">Email</button>
                  <button className="tag-chip active">In-app</button>
                  <button className="tag-chip">Slack</button>
                  <button className="tag-chip">SMS</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ background: 'var(--lake-soft)', borderColor: 'transparent' }}>
            <div className="card-eyebrow">Preview</div>
            <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
              With <strong>round-robin</strong>, each active reviewer will receive batches of <strong>{batchSize} photos</strong>. Reviewers idle for <strong>{reminderDays} days</strong> get a nudge. At current queue depth of <strong>2,481</strong>, you'll clear it in <strong>~5.3 hours</strong> with 31 active reviewers.
            </div>
          </div>

          <FlagNotifications />
        </div>
      </div>
    </>
  );
}

// Admin notification rules for flagged photos.
// Each rule: name, which flag reasons trigger it, recipient, channels.
function FlagNotifications() {
  const ALL_REASONS = [
    { id: 'inappropriate', label: 'Inappropriate' },
    { id: 'gesture',       label: 'Gesture' },
    { id: 'consent',       label: 'Consent' },
    { id: 'minor-ident',   label: 'Identifying info' },
    { id: 'second-opinion',label: 'Second opinion' },
    { id: 'safety',        label: 'Safety' },
  ];
  const ADMINS = ['Dr. Harper Rowe', 'Ana Flores (Lead)', 'Ops on-call', 'Safety team'];

  const [rules, setRules] = React.useState([
    { id: 1, name: 'Safety escalation',
      reasons: ['inappropriate','safety','minor-ident'],
      recipient: 'Safety team',
      channels: ['email','slack','sms'] },
    { id: 2, name: 'Daily digest',
      reasons: ['gesture','consent','second-opinion'],
      recipient: 'Dr. Harper Rowe',
      channels: ['email'] },
  ]);
  const [open, setOpen] = React.useState(null); // rule id being edited

  const addRule = () => {
    const id = Date.now();
    setRules([...rules, {
      id, name: 'New rule', reasons: [],
      recipient: ADMINS[0], channels: ['email'],
    }]);
    setOpen(id);
  };
  const updateRule = (id, patch) =>
    setRules(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const removeRule = (id) => setRules(rs => rs.filter(r => r.id !== id));
  const toggleIn = (arr, v) => arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];

  const CHANNEL_META = {
    email: { label: 'Email', icon: 'mail' },
    slack: { label: 'Slack', icon: 'bell' },
    sms:   { label: 'SMS',   icon: 'phone' },
    inapp: { label: 'In-app',icon: 'bell' },
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <h3 className="card-title">Flag notifications</h3>
        <span className="pill pill-sun">{rules.length} active</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
        Who gets pinged when reviewers flag a photo.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rules.map(r => (
          <div key={r.id} style={{
            border: '1px solid var(--rule)',
            borderRadius: 8,
            overflow: 'hidden',
            background: 'var(--paper)',
          }}>
            {/* Summary row */}
            <div style={{
              padding: '10px 12px',
              display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer',
            }}
              onClick={() => setOpen(open === r.id ? null : r.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 2 }}>{r.name}</div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.reasons.length || 'no'} reason{r.reasons.length === 1 ? '' : 's'} → {r.recipient} · {r.channels.join(', ')}
                </div>
              </div>
              <Icon name={open === r.id ? 'chevron-d' : 'chevron-r'} size={12} />
            </div>

            {open === r.id && (
              <div style={{
                padding: 12, borderTop: '1px solid var(--rule)',
                background: 'var(--paper-2)',
                display: 'flex', flexDirection: 'column', gap: 12,
              }}>
                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Rule name</label>
                  <input className="input"
                    value={r.name}
                    onChange={(e) => updateRule(r.id, { name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label" style={{ marginBottom: 6 }}>Trigger on</label>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {ALL_REASONS.map(reason => (
                      <button key={reason.id}
                        className={'tag-chip' + (r.reasons.includes(reason.id) ? ' active' : '')}
                        onClick={() => updateRule(r.id, { reasons: toggleIn(r.reasons, reason.id) })}
                      >
                        {reason.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="label" style={{ marginBottom: 4 }}>Notify</label>
                  <select className="select"
                    value={r.recipient}
                    onChange={(e) => updateRule(r.id, { recipient: e.target.value })}
                  >
                    {ADMINS.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label" style={{ marginBottom: 6 }}>Channels</label>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {Object.entries(CHANNEL_META).map(([id, meta]) => (
                      <button key={id}
                        className={'tag-chip' + (r.channels.includes(id) ? ' active' : '')}
                        onClick={() => updateRule(r.id, { channels: toggleIn(r.channels, id) })}
                      >
                        {meta.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <button
                    onClick={() => removeRule(r.id)}
                    style={{ color: 'var(--rose)', fontSize: 12, fontWeight: 500 }}
                  >
                    Delete rule
                  </button>
                  <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => setOpen(null)}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}

        <button
          onClick={addRule}
          style={{
            padding: '10px 12px',
            border: '1px dashed var(--rule-2)',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--ink-2)',
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add notification rule
        </button>
      </div>
    </div>
  );
}

function AdminPoints() {
  const [pts, setPts] = React.useState({
    approve: 10, reject: 10, flag: 15, streakBonus: 25,
    teamWin: 100, accurateFlag: 15, perfectBatch: 50,
  });
  const [doublePts, setDoublePts] = React.useState(true);

  return (
    <>
      <PageHeader
        eyebrow="Admin · Points"
        title="Points &amp; <em>rules.</em>"
        sub="Tune the economy. Changes go live immediately."
      >
        <button className="btn btn-primary">Save</button>
      </PageHeader>

      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Per-action points</h3>
            <div style={{ display: 'grid', gap: 2 }}>
              {[
                ['approve', 'Approve photo', 'Standard approve action'],
                ['reject',  'Reject photo',  'Standard reject with valid reason tag'],
                ['flag',    'Flag for admin','Flagging earns more — we want you to ask'],
                ['accurateFlag', 'Accurate flag bonus', 'When admin agrees with your flag'],
                ['perfectBatch', 'Perfect batch bonus', 'All 10 decisions confirmed by admin'],
                ['streakBonus',  'Daily streak bonus', 'Per day on a 3+ day streak'],
                ['teamWin',      'Team weekly win', 'To every member of the winning team'],
              ].map(([key, label, note]) => (
                <div key={key} style={{
                  display: 'grid', gridTemplateColumns: '1fr auto',
                  padding: '12px 0', borderBottom: '1px solid var(--rule)',
                  alignItems: 'center', gap: 12,
                }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{note}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px' }}
                      onClick={() => setPts({ ...pts, [key]: Math.max(0, pts[key] - 5) })}>−</button>
                    <div style={{
                      fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 500,
                      minWidth: 50, textAlign: 'center',
                    }}>
                      {pts[key]}
                    </div>
                    <button className="btn btn-ghost" style={{ padding: '4px 10px' }}
                      onClick={() => setPts({ ...pts, [key]: pts[key] + 5 })}>+</button>
                    <span className="pill" style={{ marginLeft: 6 }}>pts</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 14 }}>Bonus events</h3>
            <div style={{ padding: 16, background: 'var(--sun-soft)', borderRadius: 'var(--radius-sm)', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500 }}>
                    Double-points hour · 10:00–11:00 AM PT
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>
                    All actions earn 2× points during the window.
                  </div>
                </div>
                <button
                  onClick={() => setDoublePts(!doublePts)}
                  style={{
                    width: 44, height: 24, borderRadius: 12,
                    background: doublePts ? 'var(--sun)' : 'var(--rule-2)',
                    position: 'relative', transition: 'all 0.2s',
                  }}>
                  <div style={{
                    position: 'absolute', top: 2, left: doublePts ? 22 : 2,
                    width: 20, height: 20, borderRadius: '50%',
                    background: 'white', transition: 'all 0.2s',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                  }} />
                </button>
              </div>
            </div>
            <button className="btn btn-ghost" style={{ width: '100%' }}>
              <Icon name="plus" size={13} /> Schedule a new bonus event
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card" style={{ background: 'var(--ink)', color: 'var(--paper)', borderColor: 'var(--ink)' }}>
            <div className="card-eyebrow" style={{ color: 'color-mix(in oklch, var(--paper) 60%, transparent)' }}>Live impact</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 450, letterSpacing: '-0.02em', marginTop: 6 }}>
              Avg reviewer earns
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 56, fontWeight: 450, letterSpacing: '-0.03em', lineHeight: 1 }}>
              118<span style={{ fontSize: 20, opacity: 0.7 }}> pts/session</span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 10 }}>
              Based on last 7 days · Up 12% from last week
            </div>
          </div>

          <TagLibrary />
        </div>
      </div>
    </>
  );
}

// Tag library — typed tags (approve/reject). Approve always green, reject always red.
function TagLibrary() {
  const [tags, setTags] = React.useState([
    { id: 'hero',          label: 'Hero shot',          type: 'approve' },
    { id: 'group-energy',  label: 'Group energy',       type: 'approve' },
    { id: 'activity',      label: 'Activity context',   type: 'approve' },
    { id: 'blurry',        label: 'Blurry',             type: 'reject'  },
    { id: 'bad-expression',label: 'Bad expression',     type: 'reject'  },
    { id: 'messy-setup',   label: 'Messy setup',        type: 'reject'  },
    { id: 'bad-lighting',  label: 'Bad lighting',       type: 'reject'  },
    { id: 'inappropriate', label: 'Inappropriate',      type: 'reject'  },
  ]);
  const [adding, setAdding] = React.useState(false);
  const [newLabel, setNewLabel] = React.useState('');
  const [newType, setNewType]   = React.useState('approve');
  const inputRef = React.useRef(null);

  React.useEffect(() => { if (adding && inputRef.current) inputRef.current.focus(); }, [adding]);

  const canSave = newLabel.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    const id = newLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    setTags([...tags, { id: id || 'tag-' + Date.now(), label: newLabel.trim(), type: newType }]);
    setNewLabel('');
    setNewType('approve');
    setAdding(false);
  };
  const cancel = () => { setAdding(false); setNewLabel(''); setNewType('approve'); };
  const remove = (id) => setTags(ts => ts.filter(t => t.id !== id));

  const approve = tags.filter(t => t.type === 'approve');
  const reject  = tags.filter(t => t.type === 'reject');

  const chipStyle = (type) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '5px 10px', borderRadius: 999,
    fontSize: 12, fontWeight: 500,
    background: type === 'approve' ? 'var(--moss-soft)' : 'var(--rose-soft)',
    color:      type === 'approve' ? 'var(--moss)'      : 'var(--rose)',
    border: '1px solid transparent',
  });

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
        <h3 className="card-title">Tag library</h3>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
          {tags.length} TAGS
        </span>
      </div>

      {/* Approve section */}
      <div style={{ marginBottom: 14 }}>
        <div className="card-eyebrow" style={{ color: 'var(--moss)', marginBottom: 6 }}>
          Approve tags · positive
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {approve.map(t => (
            <span key={t.id} style={chipStyle('approve')}>
              {t.label}
              <button onClick={() => remove(t.id)} style={{
                marginLeft: 2, color: 'var(--moss)', opacity: 0.6,
                display: 'grid', placeItems: 'center',
              }}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          {approve.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
              No approve tags yet
            </span>
          )}
        </div>
      </div>

      {/* Reject section */}
      <div style={{ marginBottom: 14 }}>
        <div className="card-eyebrow" style={{ color: 'var(--rose)', marginBottom: 6 }}>
          Reject tags · reasons
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {reject.map(t => (
            <span key={t.id} style={chipStyle('reject')}>
              {t.label}
              <button onClick={() => remove(t.id)} style={{
                marginLeft: 2, color: 'var(--rose)', opacity: 0.6,
                display: 'grid', placeItems: 'center',
              }}>
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
          {reject.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
              No reject tags yet
            </span>
          )}
        </div>
      </div>

      {/* Add form */}
      {adding ? (
        <div style={{
          marginTop: 8,
          padding: 12,
          background: 'var(--paper-2)',
          border: '1px solid var(--rule)',
          borderRadius: 8,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Label</label>
            <input
              ref={inputRef}
              className="input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') cancel();
              }}
              placeholder="e.g. Candid moment"
              maxLength={32}
            />
          </div>
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Type</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                onClick={() => setNewType('approve')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: newType === 'approve' ? '1.5px solid var(--moss)' : '1px solid var(--rule)',
                  background: newType === 'approve' ? 'var(--moss-soft)' : 'var(--paper)',
                  color: newType === 'approve' ? 'var(--moss)' : 'var(--ink-2)',
                  textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: newType === 'approve' ? 500 : 400,
                }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: 'var(--moss)', flexShrink: 0,
                }} />
                Approve tag
              </button>
              <button
                onClick={() => setNewType('reject')}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: newType === 'reject' ? '1.5px solid var(--rose)' : '1px solid var(--rule)',
                  background: newType === 'reject' ? 'var(--rose-soft)' : 'var(--paper)',
                  color: newType === 'reject' ? 'var(--rose)' : 'var(--ink-2)',
                  textAlign: 'left', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, fontWeight: newType === 'reject' ? 500 : 400,
                }}>
                <span style={{
                  width: 12, height: 12, borderRadius: 6,
                  background: 'var(--rose)', flexShrink: 0,
                }} />
                Reject tag
              </button>
            </div>
          </div>
          {/* Preview */}
          <div>
            <label className="label" style={{ marginBottom: 4 }}>Preview</label>
            <span style={chipStyle(newType)}>
              {newLabel.trim() || 'Tag label'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 2 }}>
            <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
            <button className="btn btn-primary" disabled={!canSave}
              style={{ opacity: canSave ? 1 : 0.5, cursor: canSave ? 'pointer' : 'not-allowed' }}
              onClick={save}>
              <Icon name="plus" size={12} /> Add tag
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            width: '100%',
            padding: '10px 12px',
            border: '1px dashed var(--rule-2)',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--ink-2)',
            fontSize: 13, fontWeight: 500,
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <Icon name="plus" size={12} /> Add tag
        </button>
      )}
    </div>
  );
}

function AdminExamples() {
  const [tab, setTab] = React.useState('good');
  const list = EXAMPLES[tab];

  return (
    <>
      <PageHeader
        eyebrow="Admin · Examples"
        title="Example <em>library.</em>"
        sub="What reviewers see in the guide and session drawer."
      >
        <button className="btn btn-primary">
          <Icon name="plus" size={14} /> Add example
        </button>
      </PageHeader>

      <div className="page-body">
        <div style={{ display: 'flex', gap: 4, padding: 3, background: 'var(--paper-3)',
          borderRadius: 8, width: 'fit-content', marginBottom: 20 }}>
          {[['good', `Good · ${EXAMPLES.good.length}`], ['bad', `Bad · ${EXAMPLES.bad.length}`]].map(([id, label]) => (
            <button key={id}
              onClick={() => setTab(id)}
              className="btn"
              style={{
                padding: '6px 14px', fontSize: 12,
                background: tab === id ? 'var(--paper)' : 'transparent',
                boxShadow: tab === id ? 'var(--shadow-sm)' : 'none',
              }}>{label}</button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {list.map((ex, i) => (
            <div key={ex.id} className="card" style={{ padding: 12 }}>
              <div style={{
                aspectRatio: '3/2', borderRadius: 6, overflow: 'hidden',
                position: 'relative', marginBottom: 10,
                border: `2px solid var(--${tab === 'good' ? 'moss' : 'rose'})`,
                filter: tab === 'bad' && i === 0 ? 'blur(2px)' : 'none',
              }}>
                <PhotoPlaceholder photo={{ id: ex.id, camp: ex.label, activity: '' }} compact />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 500 }}>
                    {ex.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {ex.id}
                  </div>
                </div>
                <button className="btn btn-ghost" style={{ padding: '4px 6px' }}>
                  <Icon name="dots" size={14} />
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 8, lineHeight: 1.4 }}>
                {ex.note}
              </div>
            </div>
          ))}
          <button className="card" style={{
            border: '2px dashed var(--rule-2)',
            background: 'transparent',
            display: 'grid', placeItems: 'center',
            minHeight: 220, cursor: 'pointer',
            color: 'var(--ink-3)',
          }}>
            <div style={{ textAlign: 'center' }}>
              <Icon name="plus" size={24} />
              <div style={{ marginTop: 6, fontSize: 13 }}>Upload {tab} example</div>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}

function AdminUsers() {
  return (
    <>
      <PageHeader
        eyebrow="Admin · Users"
        title="<em>Reviewers.</em>"
        sub={`${ADMIN_USERS.length} accounts · 31 active in last 24h`}
      >
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
          <input className="input" placeholder="Search…" style={{ paddingLeft: 30, width: 220 }} />
        </div>
        <button className="btn btn-primary"><Icon name="plus" size={14} /> Invite</button>
      </PageHeader>

      <div className="page-body">
        <div className="card" style={{ padding: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Team</th>
                <th>Last active</th>
                <th>Status</th>
                <th style={{ width: 50 }}></th>
              </tr>
            </thead>
            <tbody>
              {ADMIN_USERS.map(u => (
                <tr key={u.email}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                        {u.name.split(' ').map(n => n[0]).slice(0,2).join('')}
                      </div>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{u.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={'pill ' + (u.role === 'Admin' ? 'pill-sun' : u.role === 'Lead' ? 'pill-lake' : '')}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{u.team}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)' }}>{u.last}</td>
                  <td>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: u.status === 'Active' ? 'var(--moss)' : 'var(--rule-2)',
                      }} />
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost" style={{ padding: '4px 6px' }}>
                      <Icon name="dots" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { AdminOverview, AdminAssignment, AdminPoints, AdminExamples, AdminUsers });
