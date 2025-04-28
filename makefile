prereqs:
	npm i typescript aws-cdk esbuild -g

stage:
	npm run package -- --environment $STAGE --region $AWS_REGION --region-postfix

deploy:
	npm ci
	npm run deploy
