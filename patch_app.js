const fs = require('fs');
const path = require('path');

const filePath = 'c:\\Users\\NeoLab\\Desktop\\SJ_NeoLab\\PROJECT\\AiGLE\\AiGLE prototype\\Aigle2\\src\\App.jsx';
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add green banner
content = content.replace(
  /                  <\/div>\s+\s+<div className="pen-list-table-wrapper"/,
  '                  </div>\n\n                  {bulkStatus === \'completed\' && (\n                    <div style={{ background: \'#10B981\', color: \'white\', padding: \'0.6rem\', borderRadius: \'8px\', textAlign: \'center\', fontWeight: 700, fontSize: \'0.85rem\', marginBottom: \'1rem\', marginTop: \'1rem\' }}>\n                       채점 완료: 모든 펜의 채점이 끝났습니다. 채점 목록에서 결과를 확인하세요.\n                    </div>\n                  )}\n\n                  <div className="pen-list-table-wrapper"'
);

// 2. Update badge logic
content = content.replace(
  /fontSize: '0\.7rem', fontWeight: 800, position: 'absolute', top: '-8px', left: '-8px', zIndex: 1 \}>7<\/div>/,
  'fontSize: \'0.7rem\', fontWeight: 800, position: \'absolute\', top: \'-8px\', left: \'-8px\', zIndex: 1 }}>{bulkStatus === \'completed\' ? \'8\' : \'7\'}</div>'
);

// 3. Update close button onClick
content = content.replace(
  /onClick=\{\(\) => \{ setIsBulkModalOpen\(false\); setBulkStatus\('ready'\); \}\}/,
  'onClick={handleCloseProcessing}'
);

fs.writeFileSync(filePath, content);
console.log('Update successful');
