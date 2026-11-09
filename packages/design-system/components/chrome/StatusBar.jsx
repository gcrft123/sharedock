import React from 'react';

/* 30px sticky telemetry strip: brand + pulsing dot, unit, sys status, live feed, lat, UTC clock. */
export function StatusBar({
  brand = 'SHAREDOCK',
  unit = 'DEVICE / A-01',
  sys = 'SYS · POOL ONLINE',
  feed = 'SAMPLE FEED · A-01 128GB · USED 71% · READ 22MB/S',
  lat = 'HOME NETWORK · 6 DEVICES',
  sticky = true,
}) {
  const [clock, setClock] = React.useState('--:--:--');
  React.useEffect(() => {
    const tick = () => {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      setClock(`${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} UTC`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <header className="statusbar" style={sticky ? undefined : { position: 'relative', top: 0 }}>
      <div className="sb-cell"><span className="dot" aria-hidden="true"></span>{brand}</div>
      <div className="sb-cell sb-mid">{unit}</div>
      <div className="sb-cell sb-mid">{sys}</div>
      <div className="sb-cell sb-mid sb-flex"><span>{feed}</span></div>
      <div className="sb-cell sb-mid">{lat}</div>
      <div className="sb-cell"><output>{clock}</output></div>
    </header>
  );
}
