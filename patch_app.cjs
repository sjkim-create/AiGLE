const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src', 'App.jsx');
let content = fs.readFileSync(filePath, 'utf8');

// 1. Add green banner
content = content.replace(
  /<\/div>\s*<\/div>\s*<\/div>\s*<div className="pen-list-table-wrapper"/,
  '</div>\n                  </div>\n                </div>\n\n                {bulkStatus === \'completed\' && (\n                  <div style={{ background: \'#10B981\', color: \'white\', padding: \'0.75rem\', borderRadius: \'8px\', textAlign: \'center\', fontWeight: 700, fontSize: \'0.9rem\', marginBottom: \'1.5rem\' }}>\n                    채점 완료: 모든 펜의 채점이 끝났습니다. 채점 목록에서 결과를 확인하세요.\n                  </div>\n                )}\n\n                <div className="pen-list-table-wrapper"'
);

// 2. Update badge logic (more flexible regex)
content = content.replace(
  /background:\s*['"]#991B1B['"],\s*color:\s*['"]white['"],\s*width:\s*['"]20px['"],\s*height:\s*['"]20px['"],\s*borderRadius:\s*['"]10px['"],\s*display:\s*['"]flex['"],\s*alignItems:\s*['"]center['"],\s*justifyContent:\s*['"]center['"],\s*fontSize:\s*['"]0\.7rem['"],\s*fontWeight:\s*800,\s*position:\s*['"]absolute['"],\s*top:\s*['- ]?8px['"],\s*left:\s*['- ]?8px['"],\s*zIndex:\s*1\s*\}\s*>\s*7\s*<\/div>/,
  'background: \'#991B1B\', color: \'white\', width: \'20px\', height: \'20px\', borderRadius: \'10px\', display: \'flex\', alignItems: \'center\', justifyContent: \'center\', fontSize: \'0.7rem\', fontWeight: 800, position: \'absolute\', top: \'-8px\', left: \'-8px\', zIndex: 1 }}>{bulkStatus === \'completed\' ? \'8\' : \'7\'}</div>'
);

// 3. Update close button onClick (should be handled already, but just in case)
if (!content.includes('onClick={handleCloseProcessing}')) {
  content = content.replace(
    /onClick=\{\(\) => \{ setIsBulkModalOpen\(false\); setBulkStatus\('ready'\); \}\}/,
    'onClick={handleCloseProcessing}'
  );
}

fs.writeFileSync(filePath, content);
console.log('Update successful');
