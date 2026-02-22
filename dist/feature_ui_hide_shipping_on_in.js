(function () {
  'use strict';

  const FC = {
    op: 'operation',
    shipTo: 'shipping'
  };

  function applyVisibility(record, isMobile) {
    const op = record[FC.op]?.value;
    const showShipping = (op === '出庫'); // 入庫のときは false

    if (isMobile) {
      kintone.mobile.app.record.setFieldShown(FC.shipTo, showShipping);
    } else {
      kintone.app.record.setFieldShown(FC.shipTo, showShipping);
    }
  }

  // PC
  kintone.events.on([
    'app.record.create.show',
    'app.record.edit.show',
    'app.record.create.change.' + FC.op,
    'app.record.edit.change.' + FC.op
  ], function (event) {
    applyVisibility(event.record, false);
    return event;
  });

  // スマホ
  kintone.events.on([
    'mobile.app.record.create.show',
    'mobile.app.record.edit.show',
    'mobile.app.record.create.change.' + FC.op,
    'mobile.app.record.edit.change.' + FC.op
  ], function (event) {
    applyVisibility(event.record, true);
    return event;
  });

})();
