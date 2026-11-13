# Use a lightweight web server
FROM nginx:alpine

# Copy all website files into the server folder
COPY . /usr/share/nginx/html

# Configure the server to listen on port 8080 (required by Cloud Run)
RUN sed -i 's/listen  *80;/listen 8080;/g' /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
