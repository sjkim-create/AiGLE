import React from 'react';

const AnalysisReport = ({ data, onBack }) => {
  const totalCount = data.length;
  
  // -- Calculations --
  const accurateCount = data.filter(d => d.matchStatus === 'exact').length;
  const accuracy = totalCount > 0 ? ((accurateCount / totalCount) * 100).toFixed(1) : 0;
  
  const totalCostUsd = data.reduce((acc, curr) => acc + (curr.costUsd || 0), 0);
  const totalCostKrw = Math.floor(totalCostUsd * 1350);
  
  // Error frequency
  const errorCounts = data.reduce((acc, curr) => {
    if (curr.errorType && curr.errorType !== '') {
      acc[curr.errorType] = (acc[curr.errorType] || 0) + 1;
    }
    return acc;
  }, {});
  
  const mostFrequentErrorKey = Object.keys(errorCounts).sort((a, b) => errorCounts[b] - errorCounts[a])[0] || 'N/A';
  const errorLabels = {
    ocr: 'OCR오류',
    hallucination: 'Hallucination(허위)',
    logic: 'Logical Error(논리)',
    rubric: 'Rubric Mismatch(기준)',
    format: 'Format/Tone(형식)',
    other: '기타'
  };
  const mostFrequentError = errorLabels[mostFrequentErrorKey] || mostFrequentErrorKey;

  // Accuracy by category
  const categories = [...new Set(data.map(d => d.category))];
  const catStats = categories.map(cat => {
    const catData = data.filter(d => d.category === cat);
    const acc = (catData.filter(d => d.matchStatus === 'exact').length / catData.length) * 100;
    const avgLat = (catData.reduce((acc, curr) => acc + parseFloat(curr.latency || 0), 0) / catData.length);
    return { name: cat, accuracy: acc, avgLatency: avgLat, count: catData.length };
  });

  // Find Worst Category (lowest accuracy)
  const worstCat = [...catStats].sort((a, b) => a.accuracy - b.accuracy)[0];
  
  // Accuracy by evalMode
  const evalModes = [...new Set(data.map(d => d.evalMode))];
  const evalAccuracy = evalModes.map(mode => {
    const modeData = data.filter(d => d.evalMode === mode);
    const acc = (modeData.filter(d => d.matchStatus === 'exact').length / modeData.length) * 100;
    return { name: mode, accuracy: acc.toFixed(1) };
  });

  // Highest Latency category for efficiency insight
  const slowestCat = [...catStats].sort((a, b) => b.avgLatency - a.avgLatency)[0];

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="ar-root">
      <header className="ar-header no-print">
        <button className="ar-back-btn" onClick={onBack}>← 아카이브로 돌아가기</button>
        <div className="ar-header-main">
          <h1 className="ar-title">AI 채점 성능 분석 리포트</h1>
          <button className="ar-print-btn" onClick={handlePrint}>🖨️ PDF 리포트 출력</button>
        </div>
      </header>

      <div className="ar-content print-content">
        {/* -- TOP SUMMARY (5 Cards from Image) -- */}
        <section className="ar-section ar-summary-grid-5">
          <div className="ar-stat-card">
            <div className="ar-stat-label">분석 데이터 수 (Total Records)</div>
            <div className="ar-stat-val"><strong>{totalCount}</strong></div>
          </div>
          <div className="ar-stat-card">
            <div className="ar-stat-label">정확도 (Exact Match)</div>
            <div className="ar-stat-val" style={{ color: '#2563EB' }}><strong>{accuracy}%</strong></div>
          </div>
          <div className="ar-stat-card">
            <div className="ar-stat-label">총 예상 비용 (Total Cost)</div>
            <div className="ar-stat-val"><strong>₩{totalCostKrw.toLocaleString()}</strong></div>
          </div>
          <div className="ar-stat-card">
            <div className="ar-stat-label">취약 영역 (Worst Area)</div>
            <div className="ar-stat-val" style={{ color: '#EF4444' }}><strong>{worstCat?.name || '-'}</strong></div>
          </div>
          <div className="ar-stat-card">
            <div className="ar-stat-label">최다 빈출 오류 (Top Error)</div>
            <div className="ar-stat-val"><strong>{mostFrequentError}</strong></div>
          </div>
        </section>

        {/* -- INSIGHTS (Matching Image Content) -- */}
        <section className="ar-section ar-card">
          <h3 className="ar-card-title">💡 분석 인사이트</h3>
          <div className="ar-insight-list-complex">
            <div className="ar-insight-box">
              <div className="ar-insight-sub">1. 취약 영역 식별 (Category Vulnerability)</div>
              <p>현재 모델은 <strong>'{worstCat?.name}'</strong> 영역에서 가장 낮은 정답률({worstCat?.accuracy.toFixed(1)}%)을 보입니다. 이는 전체 평균 대비 약 {(accuracy - (worstCat?.accuracy || 0)).toFixed(1)}%p 낮은 수치로, 해당 유형의 학습 데이터(CoT 등) 보강이 최우선 과제임을 시사합니다.</p>
            </div>
            
            <div className="ar-insight-box">
              <div className="ar-insight-sub">2. 오류 원인 진단 (Root Cause)</div>
              <p>전체 오류의 약 {totalCount > 0 ? ((errorCounts[mostFrequentErrorKey] || 0) / (totalCount - accurateCount || 1) * 100).toFixed(0) : 0}%가 <strong>'{mostFrequentError}'</strong>에서 발생하고 있습니다. 입력 이미지의 화질이나 필기 인식에 문제가 있습니다. Vision 모델의 해상도를 높이거나 전처리 과정을 점검해야 합니다.</p>
            </div>

            <div className="ar-insight-box">
              <div className="ar-insight-sub">3. 평가 모드 격차 (Auto vs Autonomous)</div>
              {(() => {
                const auto = evalAccuracy.find(e => e.name === '자동평가')?.accuracy || 0;
                const self = evalAccuracy.find(e => e.name === '자율평가')?.accuracy || 0;
                const diff = (self - auto).toFixed(1);
                return (
                  <p>자동평가 대비 자율평가(Autonomous) 모드의 정답률이 <strong>{diff}%p</strong> 더 {diff >= 0 ? '높습니다' : '낮습니다'}. 모델의 실질적인 풀이 능력은 갖춰졌으나, 엄격한 형식(Format) 기준 때문에 자동평가 모드에서 오답 처리되는 경우가 많음을 시사합니다.</p>
                );
              })()}
            </div>

            <div className="ar-insight-box">
              <div className="ar-insight-sub">4. 시간 대비 효율성 (Efficiency)</div>
              <p>가장 시간이 오래 걸리는 <strong>'{slowestCat?.name}'</strong>(평균 {slowestCat?.avgLatency.toFixed(2)}초) 영역의 정답률은 {slowestCat?.accuracy.toFixed(1)}%입니다. 긴 추론 시간에도 불구하고 준수한 정답률을 유지하고 있습니다.</p>
            </div>
          </div>
        </section>

        {/* -- CHARTS GRID (Updated) -- */}
        <div className="ar-charts-grid">
          {/* Left: Category Performance (Keep original as user likes it) */}
          <div className="ar-card">
            <h3 className="ar-card-title">📊 영역별 정답률 (Category Performance)</h3>
            <div className="ar-bar-chart">
              {catStats.sort((a,b) => b.accuracy - a.accuracy).map(cat => (
                <div key={cat.name} className="ar-bar-row">
                  <div className="ar-bar-label">{cat.name}</div>
                  <div className="ar-bar-track">
                    <div className="ar-bar-fill" style={{ width: `${cat.accuracy}%` }}></div>
                  </div>
                  <div className="ar-bar-val">{cat.accuracy.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Eval Mode Comparison (New) */}
          <div className="ar-card">
            <h3 className="ar-card-title">⚖️ 평가 모드 비교 (Auto vs Autonomous)</h3>
            <div className="ar-bar-chart">
              {evalAccuracy.map(mode => (
                <div key={mode.name} className="ar-bar-row">
                  <div className="ar-bar-label" style={{ width: '100px' }}>{mode.name}</div>
                  <div className="ar-bar-track">
                    <div className="ar-bar-fill" style={{ width: `${mode.accuracy}%`, background: '#818CF8' }}></div>
                  </div>
                  <div className="ar-bar-val">{mode.accuracy}%</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: '2rem', fontSize: '0.85rem', color: '#64748B', lineHeight: '1.5' }}>
              ℹ️ 자율평가는 모델이 스스로 사고 과정을 기록한 뒤 결과를 도출하는 방식이며, 자동평가는 규정된 스키마에 따라 즉시 답안을 생성하는 방식입니다.
            </div>
          </div>
        </div>

        {/* -- MODEL SUMMARY TABLE -- */}
        <section className="ar-section ar-card">
          <h3 className="ar-card-title">📋 모델 성능 상세 요약</h3>
          <table className="ar-table">
            <thead>
              <tr>
                <th>영역(과목)</th>
                <th>문항수</th>
                <th>정답률(%) <sup>*</sup></th>
                <th>최다 빈출 오류</th>
                <th>평균 처리 시간</th>
              </tr>
            </thead>
            <tbody>
              {catStats.map(cat => {
                const catData = data.filter(d => d.category === cat.name);
                const errors = catData.reduce((acc, curr) => {
                  if (curr.errorType) acc[curr.errorType] = (acc[curr.errorType] || 0) + 1;
                  return acc;
                }, {});
                const topErr = Object.keys(errors).sort((a,b) => errors[b]-errors[a])[0] || '-';
                
                return (
                  <tr key={cat.name}>
                    <td>{cat.name}</td>
                    <td>{cat.count}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ width: '60px', height: '6px', background: '#F1F5F9', borderRadius: '3px', overflow: 'hidden' }}>
                          <div style={{ width: `${cat.accuracy}%`, height: '100%', background: '#10B981' }}></div>
                        </div>
                        {cat.accuracy.toFixed(1)}%
                      </div>
                    </td>
                    <td>{errorLabels[topErr] || topErr}</td>
                    <td>{cat.avgLatency.toFixed(2)}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#94A3B8' }}>
            * 정답률 산정 기준: 전체 문항 중 사용자가 '정확(Exact Match)'으로 판정한 비율입니다. (정확 문항 수 / 전체 문항 수) × 100
          </div>
        </section>
      </div>

      <style>{`
        .ar-summary-grid-5 {
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 1rem;
        }
        .ar-insight-list-complex {
          display: flex;
          flex-direction: column;
          gap: 1.5rem;
        }
        .ar-insight-box {
          padding-left: 1rem;
          border-left: 4px solid #F1F5F9;
        }
        .ar-insight-sub {
          font-weight: 800;
          font-size: 1rem;
          color: #1E293B;
          margin-bottom: 0.5rem;
        }
        .ar-insight-box p {
          margin: 0;
          font-size: 0.95rem;
          color: #475569;
          line-height: 1.6;
        }
        .ar-insight-box strong {
          color: #1E293B;
        }
        @media print {
          .no-print { display: none !important; }
          .print-content { padding: 0 !important; }
          .ar-root { background: white !important; }
          .ar-card { border: 1px solid #eee !important; box-shadow: none !important; margin-bottom: 2rem !important; }
          .ar-summary-grid-5 { gap: 0.5rem; }
        }
      `}</style>
    </div>
  );
};

export default AnalysisReport;
