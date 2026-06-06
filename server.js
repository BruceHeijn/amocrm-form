const express = require('express');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const {
  getAccountInfo,
  findContactByPhone,
  createContactAndLead
} = require('./services/amocrm');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  console.log('GET /api/health');

  res.json({
    ok: true,
    message: 'Server is working'
  });
});

app.post('/api/check-phone', async (req, res) => {
  console.log('---');
  console.log('POST /api/check-phone вызван');

  try {
    const { phone } = req.body;

    console.log('Телефон из формы:', phone);

    const contact = await findContactByPhone(phone);

    if (contact) {
      console.log('✅ Контакт найден в amoCRM. ID:', contact.id);

      return res.json({
        exists: true
      });
    }

    console.log('❌ Контакт не найден в amoCRM');

    return res.json({
      exists: false
    });

  } catch (error) {
    console.error(
      'Ошибка проверки телефона:',
      error.response?.data || error.message
    );

    return res.status(500).json({
      exists: false,
      error: 'Ошибка проверки телефона'
    });
  }
});

app.post('/api/create-deal', async (req, res) => {
  console.log('---');
  console.log('POST /api/create-deal вызван');

  try {
    const result = await createContactAndLead(req.body);

    if (result.duplicate) {
      console.log('⛔ Создание остановлено: дубль найден');

      return res.status(409).json({
        ok: false,
        duplicate: true,
        message: 'Обнаружен дубль контакта по данному номеру в amoCRM'
      });
    }

    console.log('✅ Контакт и сделка успешно созданы');

    return res.json({
      ok: true,
      contactId: result.contact.id,
      leadId: result.lead.id,
      message: 'Контакт и сделка успешно созданы'
    });

  } catch (error) {
    console.error(
      'Ошибка создания сделки:',
      error.response?.data || error.message
    );

    return res.status(500).json({
      ok: false,
      message: 'Ошибка создания сделки',
      error: error.response?.data || error.message
    });
  }
});

app.get('/api/amo-test', async (req, res) => {
  console.log('GET /api/amo-test');

  try {
    const account = await getAccountInfo();

    res.json({
      ok: true,
      account
    });
  } catch (error) {
    console.error(
      'Ошибка amoCRM:',
      error.response?.data || error.message
    );

    res.status(500).json({
      ok: false,
      message: 'Ошибка подключения к amoCRM',
      error: error.response?.data || error.message
    });
  }
});

app.get('/api/oauth', async (req, res) => {
  console.log('GET /api/oauth');

  try {
    const response = await axios.post(
      `https://${process.env.AMO_DOMAIN}/oauth2/access_token`,
      {
        client_id: process.env.AMO_CLIENT_ID,
        client_secret: process.env.AMO_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: process.env.AMO_REDIRECT_URI
      }
    );

    res.json(response.data);
  } catch (error) {
    console.error(
      'Ошибка OAuth:',
      error.response?.data || error.message
    );

    res.status(500).json({
      ok: false,
      error: error.response?.data || error.message
    });
  }
});

app.listen(PORT, () => {
  console.log('==============================');
  console.log(`🚀 Server started on http://localhost:${PORT}`);
  console.log('==============================');
});