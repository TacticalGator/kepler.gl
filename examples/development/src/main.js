// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import React from 'react';
import ReactDOM from 'react-dom/client';
import document from 'global/document';
import {Provider} from 'react-redux';
import {browserHistory, Router, Route} from 'react-router';
import {syncHistoryWithStore} from 'react-router-redux';
import store from './store';
import App from './app';

const history = syncHistoryWithStore(browserHistory, store);

const Root = () => (
  <Provider store={store}>
    <Router history={history}>
      <Route path="/" component={App} />
    </Router>
  </Provider>
);

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(<Root />);
