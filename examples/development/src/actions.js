// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import {fetch} from 'global';

import {loadFiles, toggleModal} from '@kepler.gl/actions';
import {parseUri} from '@kepler.gl/common-utils';
import {load} from '@loaders.gl/core';
import {CSVLoader} from '@loaders.gl/csv';
import {GeoArrowLoader} from '@loaders.gl/arrow';
import {_GeoJSONLoader as GeoJSONLoader} from '@loaders.gl/json';
import {ParquetWasmLoader} from '@loaders.gl/parquet';

import {
  LOADING_SAMPLE_ERROR_MESSAGE,
  LOADING_SAMPLE_LIST_ERROR_MESSAGE,
  MAP_CONFIG_URL
} from './constants/default-settings';

// CONSTANTS
export const INIT = 'INIT';
export const LOAD_REMOTE_RESOURCE_SUCCESS = 'LOAD_REMOTE_RESOURCE_SUCCESS';
export const LOAD_REMOTE_DATASET_PROCESSED_SUCCESS = 'LOAD_REMOTE_DATASET_PROCESSED_SUCCESS';
export const LOAD_REMOTE_RESOURCE_ERROR = 'LOAD_REMOTE_RESOURCE_ERROR';
export const LOAD_MAP_SAMPLE_FILE = 'LOAD_MAP_SAMPLE_FILE';
export const SET_SAMPLE_LOADING_STATUS = 'SET_SAMPLE_LOADING_STATUS';

// Sharing
export const PUSHING_FILE = 'PUSHING_FILE';
export const CLOUD_LOGIN_SUCCESS = 'CLOUD_LOGIN_SUCCESS';

// ACTIONS
export function initApp() {
  return {
    type: INIT
  };
}

export function loadRemoteResourceSuccess(response, config, options, remoteDatasetConfig) {
  return {
    type: LOAD_REMOTE_RESOURCE_SUCCESS,
    response,
    config,
    options,
    remoteDatasetConfig
  };
}

export function loadRemoteDatasetProcessedSuccessAction(result) {
  return {
    type: LOAD_REMOTE_DATASET_PROCESSED_SUCCESS,
    payload: result
  };
}

export function loadRemoteResourceError(error, url) {
  return {
    type: LOAD_REMOTE_RESOURCE_ERROR,
    error,
    url
  };
}

export function setLoadingMapStatus(isMapLoading) {
  return {
    type: SET_SAMPLE_LOADING_STATUS,
    isMapLoading
  };
}

// This can be moved into Kepler.gl to provide ability to load data from remote URLs
/**
 * The method is able to load both data and kepler.gl files.
 * It uses loadFile action to dispatch and add new datasets/configs
 * to the kepler.gl instance
 * @param options
 * @param {string} options.dataUrl the URL to fetch data from. Current supported file type json,csv, kepler.json
 * @returns {Function}
 */
export function loadRemoteMap(options) {
  return dispatch => {
    dispatch(setLoadingMapStatus(true));
    // breakdown url into url+query params
    loadRemoteRawData(options.dataUrl).then(
      // In this part we turn the response into a FileBlob
      // so we can use it to call loadFiles
      ([file, url]) => {
        const {file: filename} = parseUri(url);
        dispatch(loadFiles([new File([file], filename)])).then(() =>
          dispatch(setLoadingMapStatus(false))
        );
      },
      error => {
        const {target = {}} = error;
        const {status, responseText} = target;
        dispatch(loadRemoteResourceError({status, message: responseText}, options.dataUrl));
      }
    );
  };
}

/**
 * Load a file from a remote URL
 * @param url
 * @returns {Promise<any>}
 */
function loadRemoteRawData(url) {
  if (!url) {
    // TODO: we should return reject with an appropriate error
    return Promise.resolve(null);
  }
  return fetch(url)
    .then(resp => {
      if (!resp.ok) {
        return resp.text().then(text => {
          throw new Error(text);
        });
      }
      return resp.blob();
    })
    .then(data => {
      return [data, url];
    });
}


/**
 *
 * @param url
 * @returns {Promise<any>}
 */
function loadRemoteConfig(url) {
  if (!url) {
    // TODO: we should return reject with an appropriate error
    return Promise.resolve(null);
  }

  return fetch(url).then(resp => {
    if (!resp.ok) {
      return resp.text().then(text => {
        throw new Error(text);
      });
    }
    return resp.json();
  });
}

/**
 *
 * @param url to fetch data from (csv, json, geojson)
 * @returns {Promise<any>}
 */
function loadRemoteData(url) {
  if (!url) {
    // TODO: we should return reject with an appropriate error
    return Promise.resolve(null);
  }

  // Load data
  return new Promise(resolve => {
    const loaders = [CSVLoader, GeoArrowLoader, ParquetWasmLoader, GeoJSONLoader];
    const loadOptions = {
      csv: {
        shape: 'object-row-table'
      },
      arrow: {
        shape: 'arrow-table'
      },
      parquet: {
        shape: 'arrow-table'
      },
      metadata: true
    };
    const data = load(url, loaders, loadOptions);
    resolve(data);
  });
}
