import React, { useState, useRef, useMemo } from 'react';

const MATCH_OPTIONS = [
  { value: '', label: '- 선택 -' },
  { value: 'exact', label: '✅ 정확' },
  { value: 'near', label: '⚠️ 인접' },
  { value: 'fail', label: '❌ 불일치' },
];

const ERROR_OPTIONS = [
  { value: '', label: '- 선택 -' },
  { value: 'ocr', label: 'OCR오류' },
  { value: 'hallucination', label: 'Hallucination(허위)' },
  { value: 'logic', label: 'Logical Error(논리)' },
  { value: 'rubric', label: 'Rubric Mismatch(기준)' },
  { value: 'format', label: 'Format/Tone(형식)' },
  { value: 'other', label: 'Other' },
];

const CATEGORY_OPTIONS = [
  { value: '국어', label: '국어' },
  { value: '수학', label: '수학' },
  { value: '영어', label: '영어' },
  { value: '과학', label: '과학' },
  { value: '사회', label: '사회' },
];

const EVAL_MODES = [
  { value: '자동평가', label: '자동평가' },
  { value: '자율평가', label: '자율평가' },
];

export default function TestArchive({ tests, onSetTests, onRunAnalysis }) {
  const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });
  const [selectedIds, setSelectedIds] = useState([]);
  const [filterCategory, setFilterCategory] = useState('전체');

  // --- Sorting & Filtering ---
  const sortedTests = useMemo(() => {
    let items = [...tests];
    if (filterCategory !== '전체') {
      items = items.filter(t => t.category === filterCategory);
    }

    items.sort((a, b) => {
      let aVal = a[sortConfig.key] || '';
      let bVal = b[sortConfig.key] || '';

      if (typeof aVal === 'string') {
        return sortConfig.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return items;
  }, [tests, sortConfig, filterCategory]);

  // --- Handlers ---
  const toggleSelect = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === sortedTests.length) setSelectedIds([]);
    else setSelectedIds(sortedTests.map(t => t.id));
  };

  const updateTest = (id, field, value) => {
    onSetTests(prev => prev.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const deleteTest = (id) => {
    if (!window.confirm('이 테스트 데이터를 삭제하시겠습니까?')) return;
    onSetTests(prev => prev.filter(t => t.id !== id));
  };

  const startAnalysis = () => {
    if (selectedIds.length === 0) {
      alert('분석할 데이터를 선택해 주세요.');
      return;
    }
    const selectedData = tests.filter(t => selectedIds.includes(t.id));
    onRunAnalysis(selectedData);
  };

  return (
    <div className="ta-root">
      <header className="ta-header">
        <div className="ta-header-left">
          <h1 className="ta-title">Prompt 아카이브</h1>
          <p className="ta-subtitle">스마트 채점 결과를 관리하고 데이터 분석 리포트를 생성합니다.</p>
        </div>
        <div className="ta-header-right">
          <button className="ta-btn-analyze" onClick={startAnalysis}>
            📊 {selectedIds.length}건 데이터 분석 시작
          </button>
        </div>
      </header>

      <div className="ta-toolbar">
        <div className="ta-filters">
          <select className="ta-select" value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="전체">모든 과목</option>
            {CATEGORY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            className="ta-select"
            value={sortConfig.key}
            onChange={(e) => setSortConfig({ ...sortConfig, key: e.target.value })}
          >
            <option value="date">날짜순</option>
            <option value="evalMode">평가모드 순</option>
            <option value="category">과제별</option>
          </select>
          <button
            className="ta-sort-btn"
            onClick={() => setSortConfig({ ...sortConfig, direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
          >
            {sortConfig.direction === 'asc' ? '↑ 오름차순' : '↓ 내림차순'}
          </button>
        </div>
        <div className="ta-stats">
          전체 <strong>{tests.length}</strong>건 | 선택 <strong>{selectedIds.length}</strong>건
        </div>
      </div>

      <div className="ta-table-container">
        <table className="ta-table">
          <thead>
            <tr>
              <th className="ta-th-check">
                <input type="checkbox" checked={selectedIds.length > 0 && selectedIds.length === sortedTests.length} onChange={toggleSelectAll} />
              </th>
              <th>날짜</th>
              <th>과제명</th>
              <th>과목</th>
              <th>평가모드</th>
              <th>사용 모델</th>
              <th>결과 분류(정확도)</th>
              <th>오류 유형</th>
              <th>비용</th>
              <th>액션</th>
            </tr>
          </thead>
          <tbody>
            {sortedTests.map((t) => (
              <tr key={t.id} className={selectedIds.includes(t.id) ? 'selected' : ''}>
                <td>
                  <input type="checkbox" checked={selectedIds.includes(t.id)} onChange={() => toggleSelect(t.id)} />
                </td>
                <td className="ta-td-date">{new Date(t.date).toLocaleDateString()}</td>
                <td className="ta-td-title">{t.title}</td>
                <td>
                  <span className="ta-cat-badge">{t.category}</span>
                </td>
                <td>
                  <span className="ta-mode-text">{t.evalMode}</span>
                </td>
                <td><span className="ta-model-badge">{t.model}</span></td>
                <td>
                  <select
                    className={`ta-table-select match-${t.matchStatus}`}
                    value={t.matchStatus}
                    onChange={(e) => updateTest(t.id, 'matchStatus', e.target.value)}
                  >
                    {MATCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    className={`ta-table-select error-${t.errorType}`}
                    value={t.errorType}
                    onChange={(e) => updateTest(t.id, 'errorType', e.target.value)}
                  >
                    {ERROR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td className="ta-td-cost">
                  <div className="ta-usd">${t.costUsd?.toFixed(4)}</div>
                  <div className="ta-krw">
                    ₩{((t.costUsd || 0) * 1350).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </div>
                </td>
                <td>
                  <button className="ta-btn-del" onClick={() => deleteTest(t.id)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedTests.length === 0 && (
          <div className="ta-empty">
            아카이브된 데이터가 없습니다. '스마트 채점'에서 결과를 저장해 주세요.
          </div>
        )}
      </div>
    </div>
  );
}
