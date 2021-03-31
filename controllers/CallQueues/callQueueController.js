const pool = require('../../config/db');
const validateForm = require('../../validations/validator')
const { callQueueValidations, callQueueResultValidations } = require('./callQueueValidations');
const { checkConfConnection, callConfApi } = require('../../helpers/serverTools');

const successCode = "2901";
const errorCode = "2904";

const serverError = {
  code: errorCode,
  msg: {
    error: "serverError",
  }
};

// Handle code
exports.handleCode = async (apiCode, req, res) => {

  try {
    switch (apiCode) {

      // Show callQueue
      case "2900":
        return await showCallQueue(req, res);

      // Create callQueue
      case "2910":
        return await createCallQueue(req, res);

      // Call queue list
      case "2911":
        return await callQueueList(req, res);

      // Update callQueue
      case "2912":
        return await updateCallQueue(req, res);

      // Delete callQueue
      case "2913":
        return await deleteCallQueue(req, res);

      // Enable callQueue
      case "2914":
        return await enableCallQueue(req, res);

      // Disable callQueue
      case "2915":
        return await disableCallQueue(req, res);

      // Create callQueueResult
      case "2916":
        return await createCallQueueResult(req, res);

      // Update callQueueResult
      case "2917":
        return await updateCallQueueResult(req, res);

      // Delete callQueueResult
      case "2918":
        return await deleteCallQueueResult(req, res);

      // Call queue result list
      case "2919":
        return await callQueueResultList(req, res);

      // Basic list callQueue
      case "2920":
        return await basicListCallQueue(req, res);

      // Basic list callQueueAlarms
      case "2921":
        return await basicListCallQueueAlarms(req, res);

      // Basic list callQueueResults
      case "2922":
        return await basicListCallQueueResults(req, res);
      
      // Default 
      default:
        return res.status(500).json(serverError);
    }
  } catch (error) {
    return res.status(500).json(serverError);
  }
}

// -- API METHODS -- //

// Show callQueue (2900)
const showCallQueue = async (req, res) => {
  try {
    const queueId = parseInt(req.query.id) || '';

    // If id is empty
    if (queueId === '') {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }    
   
    // Gets queue data
    const result = await getQueueData(queueId);
    
    // Not found
    if (!result) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "notFoundError",
        }
      });
    }
      
    return res.status(200).json({
      code: successCode,
      msg: {
        data: result,
      }
    });    
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }  
}

// Create callQueue (2910)
const createCallQueue = async (req, res) => {
  try {
    const dataQueueIn = req.body;

    // Validates form
    const formErrors = validateForm(dataQueueIn, callQueueValidations);

    if (formErrors) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: formErrors,
        }
      });
    }

    // Checks .conf connection
    const validConfConnection = await checkConfConnection();

    if (!validConfConnection) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: ".conf connection error",
        }
      });
    }

    // Checks that name is not in use
    const nameResult = await pool.query(
      `SELECT 
      id
      FROM queues_in 
      WHERE LOWER(name) = LOWER(?)`,
      
      [
        `${dataQueueIn.name}`
      ]
    );
    delete nameResult["meta"];
    
    if (nameResult.length > 0) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Name already exists",
        }
      });
    }

    // Checks that we are not above the record limit
    const recordCountResult = await pool.query(
      `SELECT 
      COUNT(id) as count
      FROM queues_in`
    );
    delete recordCountResult["meta"];
    
    if (recordCountResult[0].count > 999) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "recordLimit",
        }
      });
    }
    else if (recordCountResult[0].count === 0) {
      dataQueueIn["service_code"] = 0;
    }
    else {

      // Gets missing service_code value
      const missingServiceCodeResult = await pool.query(
        `SELECT
          z.expected AS missing
        FROM (
          SELECT
          @rownum:=@rownum+1 AS expected,
          IF(@rownum=service_code, 0, @rownum:=service_code) AS got
          FROM
            (SELECT @rownum:=0) AS a
            JOIN queues_in
            ORDER BY service_code 
            )
          AS z
        WHERE z.got <> 0
        LIMIT 1`
      );
      delete missingServiceCodeResult["meta"];

      if (missingServiceCodeResult.length > 0) {
        dataQueueIn["service_code"] = missingServiceCodeResult[0].missing;
      }
      else {
        // Gets max service code
        const maxCodeResult = await pool.query(
          `SELECT 
          MAX(service_code) as maxcode
          FROM queues_in`
        );
        delete maxCodeResult["meta"];
        
        dataQueueIn["service_code"] = Number(maxCodeResult[0].maxcode) + 1;
      }
    }

    // Removes some data from dataQueueIn
    const typesData = dataQueueIn.typesData.filter(item => item.name !== '' && item.results.length > 0);
    const alarmsData = dataQueueIn.alarmsData;
    delete dataQueueIn.typesData;
    delete dataQueueIn.alarmsData;
    
    // Prepares data
    const dataKeys = Object.keys(dataQueueIn);
    for (let i = 0; i < dataKeys.length; i++) {
      const key = dataKeys[i];

      // Removes '--' and ''
      if (dataQueueIn[key] === '' || dataQueueIn[key] === '--') delete dataQueueIn[key];

      // Converts bool to string
      else if (dataQueueIn[key] === true) dataQueueIn[key] = 'TRUE';
      else if (dataQueueIn[key] === false) dataQueueIn[key] = 'FALSE';
    }
    
    // Saves queue in
    const saveQueueResult = await pool.query(
      `INSERT INTO
      queues_in 
      (${Object.keys(dataQueueIn).join(',')})
      VALUES ? `,

      [
        Object.keys(dataQueueIn).map(key => dataQueueIn[key])
      ]
    ); 
    delete saveQueueResult["meta"];

    // If it was not created
    if (saveQueueResult['insertId'] === 0){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Record not created",
        }
      });
    }

    // If typesData is not empty
    let typesResult;
    if (typesData && typesData.length > 0) {

      // Values for type insert
      const typesValues = typesData.map(item => [
        item.name,
        saveQueueResult['insertId'],
        item.option
      ]);

      // Creates types
      const typesCreateResult = await pool.batch(
        `INSERT INTO
        queues_in_results_group (name, queues_in_id, option)
        VALUES (?, ?, ?)`,
        [
          ...typesValues
        ]
      );
      delete typesCreateResult["meta"];

      // Gets ids of created types
      typesResult = await pool.query(
        `SELECT id, name FROM queues_in_results_group WHERE queues_in_id = ?`, [saveQueueResult['insertId']]
      );
      delete typesResult["meta"];

      // Values for type result relation insert
      const typeRelationValues = typesResult.map(item => 
        typesData.find(type => type.name === item.name).results.map(result => [
          item.id,
          result
        ])
      ).flat();

      // Creates type result relation
      const typesRelationResult = await pool.batch(
        `INSERT INTO
        queues_in_results_relation (q_in_results_gr_id, q_in_results_id)
        VALUES (?, ?)`,
        [
          ...typeRelationValues
        ]
      );
      delete typesRelationResult["meta"];
    }

    // If alarmsData is not empty
    if (alarmsData.alarms && alarmsData.alarms.length > 0) {

      const alarmRelationValues = alarmsData.alarms.map((alarm, index) => [
        saveQueueResult['insertId'],
        alarm,
        alarmsData.operators[index],
        alarmsData.values[index],
      ]);

      // Creates alarms relationship
      const alarmRelationResult = await pool.batch(
        `INSERT INTO
          queues_in_alarms_in (queues_in_id, alarms_in_id, operator, value)
        VALUES (?, ?, ?, ?)`,
        [
          ...alarmRelationValues
        ]
      );
      delete alarmRelationResult["meta"];
    }

    // Call .conf api
    const confResponse = await callConfApi('/queues.php', {action: "Update", name: dataQueueIn.name});

    // If .conf failed
    if (confResponse.data.state !== 'OK' || confResponse.data.log !== 'Complete') {
      // Delete records
      await Promise.all([
        pool.query(`DELETE FROM queues_in WHERE id = ?`, [saveQueueResult['insertId']]),
        ...(typesResult ? [pool.query(`DELETE FROM queues_in_results_relation WHERE q_in_results_gr_id IN(${typesResult.map(item => item.id).join(',')})`)] : []),
        pool.query(`DELETE FROM queues_in_results_group WHERE queues_in_id = ?`, [saveQueueResult['insertId']]),
        pool.query(`DELETE FROM queues_in_alarms_in WHERE queues_in_id = ?`, [saveQueueResult['insertId']]),
      ])

      // Throw error
      throw "queues_in .conf error";
    }

    // Get queue data
    const showResult = await getQueueData(saveQueueResult['insertId']);
    
    return res.status(200).json({
      code: successCode,
      msg: {
        data: showResult,
      }
    });
  }
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// CallQueue list (2911)
const callQueueList = async (req, res) => {
  try {
    const filters = req.body.filters || {};

    const perpage = Number(req.body.perpage || 10);
    const page = Number(req.body.page || 1);

    const orderField = String(req.body.orderField || "name");
    const order = String(req.body.order || "asc");

    const name = String(filters.name || '');

    // Order must be "asc" or "desc"
    if (!(["asc", "desc"].includes(order.toLowerCase()))) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "order must be asc or desc",
        }
      });
    }

    // Orderfield must be one of the following fields
    const orderFields = ["name", "status"];

    if (!(orderFields.includes(orderField.toLowerCase()))) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Invalid orderField",
        }
      });
    }

    // WHERE query
    const whereQuery = name.length > 0 ? `WHERE q.name LIKE CONCAT(?, '%')` : '';

    // WHERE parameters
    const whereParam = [
      ...(name.length > 0 ? [name] : [])
    ]

    // Gets list data
    const resultData = await pool.query(
      `SELECT 
      q.id,
      IFNULL(q.name, '') as name,
      IFNULL(crm.name, '') as crm,
      IFNULL(polls.name, '') as polls,
      COUNT(DISTINCT aq.agents_id) as totalagents,
      IFNULL(q.status, '') as status
      FROM queues_in q
      LEFT JOIN queues_in_and_queues_in_groups qg ON qg.queues_in_id = q.id
      LEFT JOIN agents_queues_in_group aq ON aq.queues_in_groups_id = qg.queues_in_groups_id
      LEFT JOIN crm ON crm.id = q.crm
      LEFT JOIN polls ON polls.id = q.polls_id
      ${whereQuery}
      GROUP BY q.id
      ORDER BY ${orderField} ${order} 
      LIMIT ? 
      OFFSET ?`,
      
      [
        ... whereParam,
        perpage,
        ((page - 1) * perpage),
      ]
    );
    delete resultData["meta"];
    
    // Gets totals data
    const resultTotals = await pool.query(
      `SELECT 
        COUNT(DISTINCT id) AS records 
      FROM queues_in q
      ${whereQuery}`,

      [
        ... whereParam
      ]
    );

    delete resultTotals["meta"];

    // Checks for errors
    if (!resultTotals) {
      throw "resultTotals error";
    }

    // If resultData is empty
    if (resultData.length < 1) {
      return res.status(200).json({
        code: successCode,
        msg: {
          data: resultData,
        }
      });
    }

    // Structures list data
    const listData = [];
    for (let i = 0; i < resultData.length; i++) {                
      const item = resultData[i];
      listData.push({
        id: item.id,
        tr: [
          {
            td: 'name',
            value: item.name,
          },
          {
            td: "crm",
            value: item.crm !== '' ? item.crm : false
          },
          {
            td: "polls",
            value: item.polls !== '' ? item.polls : false
          },
          {
            td: "totalagents",
            value: item.totalagents
          },
          {
            td: "status",
            value: item.status
          }
        ]
      })
    }
    
    // Return list data
    const totalhits = resultTotals.reduce((accumulator, currentValue) => accumulator += currentValue.records, 0);
    return res.status(200).json({
      code: successCode,
      msg: {
        data: listData,
        from: ((page - 1) * perpage) + 1,
        to: Math.min(((page - 1) * perpage) + perpage, totalhits),
        per_page: Number(perpage),
        totalhits: totalhits,
        current_page: Number(page)
      }
    });
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// Update callQueue (2912)
const updateCallQueue = async (req, res) => {
  let dbConn;
  let rollbackUpdate;
  try {
    const queueId = parseInt(req.query.id) || '';
    const dataQueueIn = req.body;

    // If id is empty
    if (queueId === '') {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }
    
    // Validates form
    const formErrors = validateForm(dataQueueIn, callQueueValidations);

    if (formErrors) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: formErrors,
        }
      });
    }

    // Checks .conf connection
    const validConfConnection = await checkConfConnection();

    if (!validConfConnection) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: ".conf connection error",
        }
      });
    }

    // Checks that record exists
    const previousDataResult = await pool.query(
      `SELECT 
        *
      FROM queues_in 
      WHERE id = ?`,
      
      [
        queueId
      ]
    );
    delete previousDataResult["meta"];
    
    if (previousDataResult.length < 1) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Record not found!",
        }
      });
    }

    // If name changed
    if (dataQueueIn.name !== previousDataResult[0].name) {
      // Checks that new name is not in use
      const nameResult = await pool.query(
        `SELECT 
        id
        FROM queues_in 
        WHERE LOWER(name) = LOWER(?)
        AND id <> ?`,
        
        [
          `${dataQueueIn.name}`,
          queueId
        ]
      );
      delete nameResult["meta"];

      if (nameResult.length > 0) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "Name already exists",
          }
        });
      }

      // Checks that queue is not in use
      const inUseResult = await pool.query(
        `SELECT 
        COUNT(id)
        FROM queues_in_and_queues_in_groups 
        WHERE queues_in_id = ?`,
        
        [
          queueId
        ]
      );
      delete inUseResult["meta"];

      if (inUseResult[0].count > 0) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "inUseError",
          }
        });
      }
    }

    // Removes some data from dataQueueIn
    const typesData = dataQueueIn.typesData.filter(item => item.name !== '' && item.results.length > 0);
    const alarmsData = dataQueueIn.alarmsData;
    const priorityData = dataQueueIn.priorityData;
    delete dataQueueIn.typesData;
    delete dataQueueIn.alarmsData;
    delete dataQueueIn.priorityData;
    
    // If priorityData is not empty
    let queueAgentsResult;

    if (priorityData && priorityData.agents && priorityData.agents.length > 0) {
      queueAgentsResult = await pool.query(
        `SELECT 
          DISTINCT agents_id as id
        FROM agents_queues_in_group a
        LEFT JOIN queues_in_and_queues_in_groups qg ON qg.queues_in_groups_id = a.queues_in_groups_id
        WHERE qg.queues_in_id = ?`,
        
        [
          queueId
        ]
      );
      delete queueAgentsResult["meta"];

      // Checks that at least two agents are assigned
      if (queueAgentsResult.length < 2) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "priorityError",
          }
        });
      }
    }

    // Prepares data
    const dataKeys = Object.keys(dataQueueIn);
    for (let i = 0; i < dataKeys.length; i++) {
      const key = dataKeys[i];

      // Turns '--' to ''
      if (dataQueueIn[key] === '--') dataQueueIn[key] = '';

      // Converts bool to string
      else if (dataQueueIn[key] === true) dataQueueIn[key] = 'TRUE';
      else if (dataQueueIn[key] === false) dataQueueIn[key] = 'FALSE';
    }

    // Update queue in
    const updateQueueResult = await pool.query(
      `UPDATE
      queues_in
      SET
      ${Object.keys(dataQueueIn).map(key => `${key} = ${dataQueueIn[key] !== '' ? '?' : 'NULL'}`).join(',')}
      WHERE id = ?`,

      [
        ...Object.keys(dataQueueIn).filter(key => dataQueueIn[key] !== '').map(key => dataQueueIn[key]),
        queueId
      ]
    ); 
    delete updateQueueResult["meta"]; 
    
    // If record wasn't updated
    if (updateQueueResult['affectedRows'] === 0){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Record not updated",
        }
      });
    }

    // Gets ids of created types
    const existingTypeResults = await pool.query(
      `SELECT id, name FROM queues_in_results_group WHERE queues_in_id = ?`, [queueId]
    );
    delete existingTypeResults["meta"];

    // Gets DB connection
    dbConn = await pool.getConnection();

    // Starts transaction
    await dbConn.beginTransaction();
    
    // Deletes previous types relationship
    if (existingTypeResults.length > 0) {
      await dbConn.query(`DELETE FROM queues_in_results_relation WHERE q_in_results_gr_id IN(${existingTypeResults.map(item => item.id).join(',')})`)
    }
    await dbConn.query(`DELETE FROM queues_in_results_group WHERE queues_in_id`, [queueId]);

    // If typesData is not empty
    if (typesData && typesData.length > 0) {

      // Values for type insert
      const typesValues = typesData.map(item => [
        item.name,
        queueId,
        item.option
      ]);

      // Creates types
      const typesCreateResult = await dbConn.batch(
        `INSERT INTO
          queues_in_results_group (name, queues_in_id, option)
        VALUES (?, ?, ?)`,
        [
          ...typesValues
        ]
      );
      delete typesCreateResult["meta"];

      // Gets ids of created types
      const typesResult = await dbConn.query(
        `SELECT id, name FROM queues_in_results_group WHERE queues_in_id = ?`, [queueId]
      );
      delete typesResult["meta"];

      // Values for type result relation insert
      const typeRelationValues = typesResult.map(item => 
        typesData.find(type => type.name === item.name).results.map(result => [
          item.id,
          result
        ])
      ).flat();

      // Creates type result relation
      const typesRelationResult = await dbConn.batch(
        `INSERT INTO
          queues_in_results_relation (q_in_results_gr_id, q_in_results_id)
        VALUES (?, ?)`,
        [
          ...typeRelationValues
        ]
      );
      delete typesRelationResult["meta"];
    }

    // Deletes previous alarms relationship
    await dbConn.query(`DELETE FROM queues_in_alarms_in WHERE queues_in_id`, [queueId]);

    // If alarmsData is not empty
    if (alarmsData.alarms && alarmsData.alarms.length > 0) {

      const alarmRelationValues = alarmsData.alarms.map((alarm, index) => [
        queueId,
        alarm,
        alarmsData.operators[index],
        alarmsData.values[index],
      ]);

      // Creates alarms relationship
      const alarmRelationResult = await dbConn.batch(
        `INSERT INTO
          queues_in_alarms_in (queues_in_id, alarms_in_id, operator, value)
        VALUES (?, ?, ?, ?)`,
        [
          ...alarmRelationValues
        ]
      );
      delete alarmRelationResult["meta"];
    }

    // Deletes previous priority relationship
    await dbConn.query(`DELETE FROM queues_priority_in WHERE queues_in_id`, [queueId]);

    // If priorityData is not empty
    if (priorityData && priorityData.agents && priorityData.agents.length > 0) {

      const priorityRelationValues = priorityData.agents.map((agent, index) => [
        queueId,
        agent,
        priorityData.priority[index]
      ]);

      // Creates priority relationship
      const priorityRelationResult = await dbConn.batch(
        `INSERT INTO
        queues_priority_in (queues_in_id, agents_id, priority)
        VALUES (?, ?, ?)`,
        [
          ...priorityRelationValues
        ]
      );
      delete priorityRelationResult["meta"];
    }

    // Rollback queue function
    rollbackUpdate = async () => {
      const rollbackQueueResult = await pool.query(
        `UPDATE
        queues_in
        SET
        ${Object.keys(previousDataResult[0]).map(key => `${key} = ${previousDataResult[0][key] !== '' ? '?' : 'NULL'}`).join(',')}
        WHERE id = ?`,

        [
          ...Object.keys(previousDataResult[0]).filter(key => previousDataResult[0][key] !== '').map(key => previousDataResult[0][key]),
          queueId
        ]
      ); 
      delete rollbackQueueResult["meta"];
    }

    // If name changed
    if (dataQueueIn.name !== previousDataResult[0].name) {
      // Call Raname .conf api
      const renameConfResponse = await callConfApi('/queues.php', {action: "Rename", name: dataQueueIn.name, namebefore: previousDataResult[0].name});

      // If .conf failed
      if (renameConfResponse.data.state !== 'OK' || renameConfResponse.data.log !== 'Complete') {
        // Throw error
        throw "queues_in .conf (rename) error";
      }
    }
    // If name did not change
    else {
      // Call .conf api
      const confResponse = await callConfApi('/queues.php', {action: "Update", name: dataQueueIn.name});

      // If .conf failed
      if (confResponse.data.state !== 'OK' || confResponse.data.log !== 'Complete') {
        // Throw error
        throw "queues_in .conf error";
      }
    }

    // If everything is OK, commit transaction and release connection
    await dbConn.commit();
    dbConn.release();

    // Get queue data
    const showResult = await getQueueData(queueId);
    
    return res.status(200).json({
      code: successCode,
      msg: {
        data: showResult,
      }
    });

  } 
  catch (error) {
    // DB connection rollback and release.
    if (dbConn) {
      await dbConn.rollback();
      dbConn.release();
    }
    if (rollbackUpdate) {
      rollbackUpdate();
    }

    return res.status(500).json(serverError);
  }
}

// Delete callQueue (2913)
const deleteCallQueue = async (req, res) => {
  try {
    const queueId = parseInt(req.query.id) || '';

    // If id is empty
    if (queueId === ''){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }

    // Checks that queue is not in use
    const inUseResult = await pool.query(
      `SELECT COUNT(id) as count FROM queues_in_and_queues_in_groups WHERE queues_in_id = ?`, [queueId]
    );
    delete inUseResult["meta"];

    if (inUseResult[0].count > 0) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "inUseError",
        }
      });
    }

    // Checks .conf connection
    const validConfConnection = await checkConfConnection();

    if (!validConfConnection) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: ".conf connection error",
        }
      });
    }
  
    // Gets queue data
    const queueResult = await pool.query(`SELECT * FROM queues_in WHERE id = ?`, [queueId]);
    delete queueResult["meta"];
    
    // Not found
    if (!queueResult || queueResult.length < 1) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "notFoundError",
        }
      });
    }

    // Gets types data
    const typesResult = await pool.query(
      `SELECT * FROM queues_in_results_group WHERE queues_in_id = ?`, [queueId]
    );
    delete typesResult["meta"];

    // Gets types relation data
    let typesRelationResult;
    if (typesResult.length > 0) {
      typesRelationResult = await pool.query(
        `SELECT * FROM queues_in_results_relation WHERE q_in_results_gr_id IN(${typesResult.map(item => item.id).join(',')})`
      );
      delete typesRelationResult["meta"];
    }

    // Gets alarms data
    const alarmsResult = await pool.query(
      `SELECT * FROM queues_in_alarms_in WHERE queues_in_id = ?`, [queueId]
    );
    delete alarmsResult["meta"];

    // Delete alarms relation
    await pool.query(`DELETE FROM queues_in_alarms_in WHERE queues_in_id = ? `, [queueId]);

    // Deletes previous types relationship
    if (typesRelationResult && typesRelationResult.length > 0) {
      await pool.query(`DELETE FROM queues_in_results_relation WHERE q_in_results_gr_id IN(${typesRelationResult.map(item => item.id).join(',')})`)
    }
    await pool.query(`DELETE FROM queues_in_results_group WHERE queues_in_id`, [queueId]);

    // Delete queue
    await pool.query(`DELETE FROM queues_in WHERE id = ? `, [queueId]);

    // Call .conf api
    const confResponse = await callConfApi('/queues.php', {action: "Delete", name: queueResult[0].name});

    // If .conf failed
    if (confResponse.data.state !== 'OK' || confResponse.data.log !== 'Complete') {
      // Rollback queue
      const rollbackQueueResult = await pool.query(
        `INSERT INTO queues_in (${Object.keys(queueResult[0]).filter(key => queueResult[0][key] !== null).join(',')}) VALUES ?`,
        [
          Object.keys(queueResult[0]).filter(key => queueResult[0][key] !== null).map(key => queueResult[0][key])
        ]
      ); 
      delete rollbackQueueResult["meta"];

      // Rollback types
      if (typesResult.length > 0) {
        await pool.batch(
          `INSERT INTO queues_in_results_group (${Object.keys(typesResult[0]).join(',')}) 
          VALUES (${Object.keys(typesResult[0]).map(() => '?').join(',')}) `,
          [
            ...typesResult.map(item => Object.keys(item).map(key => item[key]))
          ]
        );
      }

      // Rollback types relation
      if (typesRelationResult && typesRelationResult.length > 0) {
        await pool.batch(
          `INSERT INTO queues_in_results_relation (${Object.keys(typesRelationResult[0]).join(',')}) 
          VALUES (${Object.keys(typesRelationResult[0]).map(() => '?').join(',')}) `,
          [
            ...typesRelationResult.map(item => Object.keys(item).map(key => item[key]))
          ]
        );
      }

      // Rollback alarms
      if (alarmsResult.length > 0) {
        await pool.batch(
          `INSERT INTO queues_in_alarms_in (${Object.keys(alarmsResult[0]).join(',')}) 
          VALUES (${Object.keys(alarmsResult[0]).map(() => '?').join(',')}) `,
          [
            ...alarmsResult.map(item => Object.keys(item).map(key => item[key]))
          ]
        );
      }

      // Throw error
      throw "queues_in .conf error";
    }

    // If everything is OK, return success response
    return res.status(200).json({
      code: successCode,
      msg: {
        data: {
          delete: true
        }
      }
    });
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// Enable callQueue (2914)
const enableCallQueue = async (req, res) => {
  try {
    const queueId = parseInt(req.query.id) || '';

    // If id is empty
    if (queueId === ''){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }
  
    // Checks if record exists
    const existResult = await pool.query(`SELECT id, name, status FROM queues_in WHERE id = ?`, [queueId]);
    delete existResult["meta"];
    
    // Not found
    if (!existResult || existResult.length < 1) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "notFoundError",
        }
      });
    }

    // Checks .conf connection
    const validConfConnection = await checkConfConnection();

    if (!validConfConnection) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: ".conf connection error",
        }
      });
    }

    // Change status to ACTIVE
    const resultUpdate = await pool.query(`UPDATE queues_in SET status = 'ACTIVE' WHERE id = ?`, [queueId]); 

    // If status was not updated
    if (resultUpdate['affectedRows'] === 0){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Status not updated!",
        }
      });
    }

    // Call .conf api
    const confResponse = await callConfApi('/queues.php', {action: "Update", name: existResult[0].name});

    // If .conf failed
    if (confResponse.data.state !== 'OK' || confResponse.data.log !== 'Complete') {
      // Rollback status change
      await pool.query(`UPDATE queues_in SET status = ? WHERE id = ?`, [existResult[0].status, queueId]); 

      // Throw error
      throw "queues_in .conf error";
    }

    // If everything is OK, return success response
    return res.status(200).json({
      code: successCode,
      msg: {
        data: {
          active: true
        }
      }
    });
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// Disable callQueue (2915)
const disableCallQueue = async (req, res) => {
  try {
    const queueId = parseInt(req.query.id) || '';

    // If id is empty
    if (queueId === ''){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }

    // Checks that queue is not in use
    const inUseResult = await pool.query(
      `SELECT COUNT(id) as count FROM queues_in_and_queues_in_groups WHERE queues_in_id = ?`, [queueId]
    );
    delete inUseResult["meta"];

    if (inUseResult[0].count > 0) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "inUseError",
        }
      });
    }
  
    // Checks if record exists
    const existResult = await pool.query(`SELECT id, name, status FROM queues_in WHERE id = ?`, [queueId]);
    delete existResult["meta"];
    
    // Not found
    if (!existResult || existResult.length < 1) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "notFoundError",
        }
      });
    }

    // Checks .conf connection
    const validConfConnection = await checkConfConnection();

    if (!validConfConnection) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: ".conf connection error",
        }
      });
    }

    // Change status to INACTIVE
    const resultUpdate = await pool.query(`UPDATE queues_in SET status = 'INACTIVE' WHERE id = ?`, [queueId]); 

    // If status was not updated
    if (resultUpdate['affectedRows'] === 0){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Status not updated!",
        }
      });
    }

    // Call .conf api
    const confResponse = await callConfApi('/queues.php', {action: "Update", name: existResult[0].name});

    // If .conf failed
    if (confResponse.data.state !== 'OK' || confResponse.data.log !== 'Complete') {
      // Rollback status change
      await pool.query(`UPDATE queues_in SET status = ? WHERE id = ?`, [existResult[0].status, queueId]); 

      // Throw error
      throw "queues_in .conf error";
    }

    // If everything is OK, return success response
    return res.status(200).json({
      code: successCode,
      msg: {
        data: {
          inactive: true
        }
      }
    });
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// Create callQueueResult (2916)
const createCallQueueResult = async (req, res) => {
  try {
    const dataQueueResult = req.body;

    // Validates form
    const formErrors = validateForm(dataQueueResult, callQueueResultValidations);

    if (formErrors) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: formErrors,
        }
      });
    }

    // Checks that name is not in use
    const nameResult = await pool.query(
      `SELECT 
        id
        FROM queues_in_results 
      WHERE LOWER(name) = LOWER(?)`,
      
      [
        `${dataQueueResult.name}`
      ]
    );
    delete nameResult["meta"];
    
    if (nameResult.length > 0) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Name already exists",
        }
      });
    }
    
    // Saves queue result
    const saveQueueResultResult = await pool.query(
      `INSERT INTO
        queues_in_results 
      (${Object.keys(dataQueueResult).join(',')})
      VALUES ? `,

      [
        Object.keys(dataQueueResult).map(key => dataQueueResult[key])
      ]
    ); 
    delete saveQueueResultResult["meta"];

    // If it was not created
    if (saveQueueResultResult['insertId'] === 0){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Record not created",
        }
      });
    }

    // Get queue result data
    const showResult = await getQueueResultData(saveQueueResultResult['insertId']);
    
    return res.status(200).json({
      code: successCode,
      msg: {
        data: showResult,
      }
    });
  }
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// Update callQueueResult (2917)
const updateCallQueueResult = async (req, res) => {
  try {
    const resultId = parseInt(req.query.id) || '';
    const dataQueueResult = req.body;

    // If id is empty
    if (resultId === '') {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }
    
    // Validates form
    const formErrors = validateForm(dataQueueResult, callQueueResultValidations);

    if (formErrors) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: formErrors,
        }
      });
    }

    // Checks that record exists
    const previousDataResult = await pool.query(
      `SELECT 
        id,
        name
      FROM queues_in_results 
      WHERE id = ?`,
      
      [
        resultId
      ]
    );
    delete previousDataResult["meta"];
    
    if (previousDataResult.length < 1) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Record not found!",
        }
      });
    }

    // If name changed
    if (dataQueueResult.name !== previousDataResult[0].name) {
      // Checks that new name is not in use
      const nameResult = await pool.query(
        `SELECT 
          id
        FROM queues_in_results 
        WHERE LOWER(name) = LOWER(?)
        AND id <> ?`,
        
        [
          `${dataQueueResult.name}`,
          resultId
        ]
      );
      delete nameResult["meta"];

      if (nameResult.length > 0) {
        return res.status(200).json({
          code: errorCode,
          msg: {
            error: "Name already exists",
          }
        });
      }
    }

    // Updates result
    const updateResultResult = await pool.query(
      `UPDATE
      queues_in_results
      SET
      ${Object.keys(dataQueueResult).map(key => `${key} = ${dataQueueResult[key] !== '' ? '?' : 'NULL'}`).join(',')}
      WHERE id = ?`,

      [
        ...Object.keys(dataQueueResult).filter(key => dataQueueResult[key] !== '').map(key => dataQueueResult[key]),
        resultId
      ]
    ); 
    delete updateResultResult["meta"]; 
    
    // If record wasn't updated
    if (updateResultResult['affectedRows'] === 0){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Record not updated",
        }
      });
    }

    // Get queue result data
    const showResult = await getQueueResultData(resultId);
    
    return res.status(200).json({
      code: successCode,
      msg: {
        data: showResult,
      }
    });

  } 
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// Delete callQueueResult (2918)
const deleteCallQueueResult = async (req, res) => {
  try {
    const resultId = parseInt(req.query.id) || '';

    // If id is empty
    if (resultId === ''){
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "id is empty",
        }
      });
    }

    // Checks if record exists
    const existsResult = await pool.query(
      `SELECT 
        id
      FROM queues_in_results 
      WHERE id = ? `,
      
      [
        `${resultId}`
      ]
    );
    delete existsResult["meta"];
    
    // Not found
    if (!existsResult || existsResult.length < 1) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "notFoundError",
        }
      });
    }

    // Checks that result is not in use
    const inUseResult = await pool.query(
      `SELECT COUNT(id) as count FROM queues_in_results_relation WHERE q_in_results_id = ?`, [resultId]
    );
    delete inUseResult["meta"];

    if (inUseResult[0].count > 0) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "inUseError",
        }
      });
    }

    // Delete result
    await pool.query(`DELETE FROM queues_in_results WHERE id = ? `, [resultId]);

    // If everything is OK, return success response
    return res.status(200).json({
      code: successCode,
      msg: {
        data: {
          delete: true
        }
      }
    });
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// CallQueue result list (2919)
const callQueueResultList = async (req, res) => {
  try {
    const filters = req.body.filters || {};

    const perpage = Number(req.body.perpage || 10);
    const page = Number(req.body.page || 1);

    const orderField = String(req.body.orderField || "name");
    const order = String(req.body.order || "asc");

    const name = String(filters.name || '');

    // Order must be "asc" or "desc"
    if (!(["asc", "desc"].includes(order.toLowerCase()))) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "order must be asc or desc",
        }
      });
    }

    // Orderfield must be one of the following fields
    const orderFields = ["name"];

    if (!(orderFields.includes(orderField.toLowerCase()))) {
      return res.status(200).json({
        code: errorCode,
        msg: {
          error: "Invalid orderField",
        }
      });
    }

    // WHERE query
    const whereQuery = name.length > 0 ? `WHERE name LIKE CONCAT(?, '%')` : '';

    // WHERE parameters
    const whereParam = [
      ...(name.length > 0 ? [name] : [])
    ]

    // Gets list data
    const resultData = await pool.query(
      `SELECT 
        id,
        name,
        IFNULL(description, '') as description,
        abbreviation,
        color
      FROM queues_in_results
      ${whereQuery}
      GROUP BY id
      ORDER BY ${orderField} ${order} 
      LIMIT ? 
      OFFSET ?`,
      
      [
        ... whereParam,
        perpage,
        ((page - 1) * perpage),
      ]
    );
    delete resultData["meta"];
    
    // Gets totals data
    const resultTotals = await pool.query(
      `SELECT 
        COUNT(DISTINCT id) AS records 
      FROM queues_in_results
      ${whereQuery}`,

      [
        ... whereParam
      ]
    );

    delete resultTotals["meta"];

    // Checks for errors
    if (!resultTotals) {
      throw "resultTotals error";
    }

    // If resultData is empty
    if (resultData.length < 1) {
      return res.status(200).json({
        code: successCode,
        msg: {
          data: resultData,
        }
      });
    }
    
    // Return list data
    const totalhits = resultTotals.reduce((accumulator, currentValue) => accumulator += currentValue.records, 0);
    return res.status(200).json({
      code: successCode,
      msg: {
        data: resultData,
        from: ((page - 1) * perpage) + 1,
        to: Math.min(((page - 1) * perpage) + perpage, totalhits),
        per_page: Number(perpage),
        totalhits: totalhits,
        current_page: Number(page)
      }
    });
  } 
  catch (error) {
    return res.status(500).json(serverError);
  }
}

// Basic list callQueue (2920)
const basicListCallQueue = async (_req, res) => {
  try {
    // Get queue data
    const queuesResult = await pool.query(
      `SELECT 
        id,
        name,
        service_code
      FROM queues_in 
      ORDER BY name asc`
    );
    delete queuesResult["meta"];

    // Returns data
    return res.status(200).json({
      code: successCode,
      msg: {
        data: queuesResult
      }
    });
  }
  catch (error) {
    return res.status(500).json(serverError);
  }
};

// Basic list callQueueAlarms (2921)
const basicListCallQueueAlarms = async (_req, res) => {
  try {
    // Get alarms data
    const alarmsResult = await pool.query(
      `SELECT 
        * 
      FROM alarms_in 
      ORDER BY apply_to asc, name asc`
    );
    delete alarmsResult["meta"];

    // Returns data
    return res.status(200).json({
      code: successCode,
      msg: {
        data: alarmsResult
      }
    });
  }
  catch (error) {
    return res.status(500).json(serverError);
  }
};

// Basic list callQueueResults (2922)
const basicListCallQueueResults = async (_req, res) => {
  try {
    // Queue results data
    const resultData = await pool.query(
      `SELECT 
        id, 
        name  
      FROM queues_in_results 
      ORDER BY name asc`
    );
    delete resultData["meta"];

    // Returns data
    return res.status(200).json({
      code: successCode,
      msg: {
        data: resultData
      }
    });
  }
  catch (error) {
    return res.status(500).json(serverError);
  }
};

// -- INTERNAL FUNCTIONS --  //

// Get queue data (show)
const getQueueData = async (id) => {

  // Gets queue data
  const result = await pool.query(`SELECT * FROM queues_in WHERE id = ?`, [id]);
  delete result["meta"];

  // Checks for errors
  if (!result || result.length < 1) return false;
  
  // Data
  const data = result[0];

  // Gets types data
  const typesResult = await pool.query(
    `SELECT 
      qig.id,
      qig.name,
      qig.option,
      IFNULL(GROUP_CONCAT(qr.q_in_results_id SEPARATOR ','), '') as results 
    FROM queues_in_results_group qig
    LEFT JOIN queues_in_results_relation qr ON qr.q_in_results_gr_id = qig.id
    WHERE qig.queues_in_id = ?
    GROUP BY qig.id`,
    [
      id
    ]
  );
  delete typesResult["meta"];

  // Gets alarms data
  const alarmsResult = await pool.query(
    `SELECT 
      alarms_in_id as alarm,
      operator,
      value
    FROM queues_in_alarms_in qa
    WHERE qa.queues_in_id = ?`,
    [
      id
    ]
  );
  delete alarmsResult["meta"];

  // Gets agents in queue
  const agentsResult = await pool.query(
    `SELECT 
      DISTINCT agents_id as id
    FROM agents_queues_in_group a
    LEFT JOIN queues_in_and_queues_in_groups qg ON qg.queues_in_groups_id = a.queues_in_groups_id
    WHERE qg.queues_in_id = ?`,
    [
      id
    ]
  );
  delete agentsResult["meta"];

  data.totalagents = agentsResult.length;
  
  // Get agents priority
  if (agentsResult.length > 0) {
    const agentPriorityResult = await pool.query(
      `SELECT 
        a.id,
        u.name,
        a.number,
        IFNULL(qp.priority, '') as priority
      FROM agents a
      LEFT JOIN users u ON u.id = a.users_id
      LEFT JOIN queues_priority_in qp ON qp.agents_id = a.id
      WHERE a.id IN(${agentsResult.map(item => item.id).join(',')})
      GROUP BY a.id`
    );
    delete agentPriorityResult["meta"];

    data.agentData = agentPriorityResult;
  }
  else {
    data.agentData = [];
  }

  // Prepares data
  const dataKeys = Object.keys(data);
  for (let i = 0; i < dataKeys.length; i++) {
    const key = dataKeys[i];

    // Converts null to ''
    if (data[key] === null) data[key] = '';

    // Bool values
    else if (data[key] === 'TRUE') data[key] = true;
    else if (data[key] === 'FALSE') data[key] = false;
  }

  // Structures types
  if (typesResult.length > 0) {
    const types = [];
    for (let i = 0; i < 3; i++) {
      const type = typesResult.find(item => item.option === `result_${i + 1}`);

      // If type exists, add it and continue
      if (type) {
        types.push({
          ...type,
          results: type.results === '' ? [] : type.results.split(',').map(item => Number(item))
        });
        continue;
      }

      // If type doesn't exist, add empty type
      types.push({
        name: "",
        results: [],
        option: `result_${i + 1}`,
      })
    }
    data.typesData = types;
  }
  else {
    data.typesData = [];
  }

  // Alarms data
  data.alarmsData = {};
  if (alarmsResult.length > 0) {
    data.alarmsData.alarms = alarmsResult.map(item => item.alarm);
    data.alarmsData.operators = alarmsResult.map(item => item.operator);
    data.alarmsData.values = alarmsResult.map(item => item.value);
  }
  
  // Returns data
  return data;
}

// Get queue result data (show)
const getQueueResultData = async (id) => {

  // Gets queue data
  const result = await pool.query(`SELECT * FROM queues_in_results WHERE id = ?`, [id]);
  delete result["meta"];
  console.log(result)
  // Checks for errors
  // if (!result || result.length < 1) return false;
  
  // Data
  const data = result[0];
  
  // Returns data
  return data;
}