import os
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

import os
import json
import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()

def get_firebase_credentials():
    key_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "firebase-historyservice.json")
    if os.path.exists(key_path):
        return credentials.Certificate(key_path)

    # Fallback to AWS Secrets Manager
    print(f"Local {key_path} not found. Attempting to fetch from AWS Secrets Manager...")
    secret_name = "peerprep/firebase-history"
    region_name = os.getenv("AWS_REGION", "ap-southeast-1")

    session = boto3.session.Session()
    client = session.client(service_name='secretsmanager', region_name=region_name)

    try:
        get_secret_value_response = client.get_secret_value(SecretId=secret_name)
        if 'SecretString' in get_secret_value_response:
            secret_data = json.loads(get_secret_value_response['SecretString'])
            return credentials.Certificate(secret_data)
        else:
            raise Exception("SecretString not found in Secrets Manager response")
    except ClientError as e:
        print(f"FAILED to fetch secret from AWS: {str(e)}")
        # Fallback to default credentials as a last resort
        return None

# Initialize Firestore
if not firebase_admin._apps:
    cred = get_firebase_credentials()
    if cred:
        firebase_admin.initialize_app(cred)
    else:
        try:
            firebase_admin.initialize_app()
        except Exception as e:
            print(f"CRITICAL: Firebase initialization failed: {str(e)}")

db = firestore.client()